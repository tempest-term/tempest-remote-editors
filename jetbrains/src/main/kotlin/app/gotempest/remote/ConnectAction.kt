package app.gotempest.remote

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.execution.configurations.PathEnvironmentVariableUtil
import com.intellij.ide.util.PropertiesComponent
import com.intellij.openapi.Disposable
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.components.service
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.progress.Task
import com.intellij.openapi.progress.ProcessCanceledException
import com.jetbrains.gateway.api.GatewayUI
import net.schmizz.sshj.common.Buffer
import net.schmizz.sshj.common.KeyType
import net.schmizz.sshj.transport.verification.OpenSSHKnownHosts
import java.util.Base64
import com.intellij.remote.SshConnectionConfigPatch
import com.intellij.remote.AuthType
import com.intellij.ssh.config.unified.SshConfig
import com.intellij.ssh.config.unified.SshConfigManager
import com.intellij.ssh.ui.unified.SshUiData
import com.intellij.openapi.ui.Messages
import com.intellij.ui.components.ActionLink
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import com.intellij.util.ui.update.UiNotifyConnector
import java.awt.*
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import javax.swing.*

class Connections : Disposable {
    private val processes = ConcurrentHashMap.newKeySet<Process>()
    fun add(process: Process) { processes.add(process) }
    fun remove(process: Process) { processes.remove(process) }
    override fun dispose() { processes.forEach { it.destroy() }; processes.clear() }
}

class ConnectAction : AnAction() {
    override fun actionPerformed(event: AnActionEvent) { GatewayUI.getInstance().showConnectorView("tempest") }
}
private data class Server(val id: String, val label: String, val description: String? = null) {
    override fun toString() = if (description.isNullOrBlank()) label else "$label · $description"
}

/** Shared embedded form. UI work uses the modality captured from its own component. */
internal class ConnectionPanel(
    private val onBack: (() -> Unit)? = null,
    private val onConnected: () -> Unit,
) : JPanel(BorderLayout()), Disposable {
    private val log = Logger.getInstance(ConnectionPanel::class.java)
    private val settings = PropertiesComponent.getInstance()
    private val node = JTextField(settings.getValue("tempest.node", "node"))
    private val cli = JTextField(settings.getValue("tempest.cli", "tempest"))
    private val servers = JComboBox<Server>()
    private val refresh = JButton("Refresh")
    private val connect = JButton("Continue in Gateway")
    private val cancel = JButton("Cancel")
    private val advancedLink = ActionLink("Advanced settings") {}
    private val advanced = JPanel(GridBagLayout())
    @Volatile private var disposed = false
    @Volatile private var active: Job? = null
    private val helper by lazy { extractHelper() }
    private class Job(val loading: Boolean, @Volatile var modality: ModalityState) {
        val finished = CountDownLatch(1)
        @Volatile var indicator: ProgressIndicator? = null
        @Volatile var gateway: JsonObject? = null
        @Volatile var failure: String? = null
        @Volatile var process: Process? = null
        @Volatile var cancelled = false
    }

    init {
        border = JBUI.Borders.empty(24, 32)
        val content = JPanel(GridBagLayout())
        content.isOpaque = false
        var row = 0
        fun full(component: JComponent, gap: Int = 12) {
            content.add(component, GridBagConstraints().apply {
                gridx = 0; gridy = row++; gridwidth = 2; weightx = 1.0
                fill = GridBagConstraints.HORIZONTAL; anchor = GridBagConstraints.NORTHWEST
                insets = JBUI.insets(0, 0, gap, 0)
            })
        }
        if (onBack != null) full(ActionLink("Back") { dispose(); onBack.invoke() }, 20)
        full(JBLabel("Connect with Tempest").apply { font = font.deriveFont(Font.BOLD, 20f) }, 6)
        full(JBLabel("Prepare a saved server, then continue in Gateway’s SSH wizard.").apply {
            foreground = UIUtil.getContextHelpForeground()
        }, 24)
        val serverRow = JPanel(BorderLayout(JBUI.scale(8), 0)).apply {
            add(servers, BorderLayout.CENTER); add(refresh, BorderLayout.EAST)
        }
        full(labeled("Server", serverRow))
        full(advancedLink, 8)
        advanced.add(labeled("Node.js executable", node), constraints(0))
        advanced.add(labeled("Tempest CLI executable", cli), constraints(1))
        advanced.isVisible = false
        full(advanced, 12)
        val actions = JPanel(FlowLayout(FlowLayout.LEFT, 0, 0)).apply {
            add(connect); add(Box.createHorizontalStrut(JBUI.scale(8))); add(cancel)
        }
        full(actions, 12)
        val top = JPanel(BorderLayout()).apply { add(content, BorderLayout.NORTH) }
        add(JScrollPane(top).apply { border = null; horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER }, BorderLayout.CENTER)
        minimumSize = Dimension(JBUI.scale(480), JBUI.scale(440))
        preferredSize = Dimension(JBUI.scale(610), JBUI.scale(520))
        servers.renderer = object : DefaultListCellRenderer() {
            override fun getListCellRendererComponent(list: JList<*>?, value: Any?, index: Int, selected: Boolean, focus: Boolean): Component =
                super.getListCellRendererComponent(list, value ?: "Select a server", index, selected, focus)
        }
        connect.isEnabled = false; cancel.isVisible = false
        servers.addActionListener { connect.isEnabled = active == null && servers.selectedItem != null }
        refresh.addActionListener { loadServers() }
        connect.addActionListener { connectServer() }
        cancel.addActionListener { cancelJob() }
        advancedLink.addActionListener {
            advanced.isVisible = !advanced.isVisible
            advancedLink.text = if (advanced.isVisible) "Hide advanced settings" else "Advanced settings"
            revalidate(); repaint()
        }
        UiNotifyConnector.doWhenFirstShown(this) { if (!disposed) loadServers() }
    }

    private fun labeled(label: String, field: JComponent): JPanel = JPanel(BorderLayout(0, JBUI.scale(6))).apply {
        add(JBLabel(label).apply { labelFor = field }, BorderLayout.NORTH); add(field, BorderLayout.CENTER)
    }
    private fun constraints(row: Int) = GridBagConstraints().apply {
        gridx = 0; gridy = row; weightx = 1.0; fill = GridBagConstraints.HORIZONTAL
        insets = JBUI.insets(0, 0, 12, 0)
    }
    private fun ui(job: Job, action: () -> Unit) {
        ApplicationManager.getApplication().invokeLater({
            if (!disposed && active === job) action()
        }, job.modality)
    }
    private fun busy(value: Boolean) {
        for (component in listOf(servers, node, cli, refresh)) component.isEnabled = !value
        connect.isEnabled = !value && servers.selectedItem != null
        cancel.isVisible = value
    }
    private fun loadServers() = start(listOf("list"), true)
    private fun connectServer() {
        val selected = servers.selectedItem as? Server ?: return
        for ((key, value) in mapOf("node" to node.text, "cli" to cli.text)) settings.setValue("tempest.$key", value)
        val args = listOf("connect", "--server-id", selected.id, "--editor", "jetbrains")
        start(args, false)
    }
    private fun start(args: List<String>, loading: Boolean) {
        if (disposed || active != null) return
        val job = Job(loading, ModalityState.stateForComponent(this))
        active = job; busy(true)
        val nodePath = node.text.trim(); val cliPath = cli.text.trim()
        val launchReader = Runnable { runHelper(job, args, nodePath, cliPath) }
        if (loading) ApplicationManager.getApplication().executeOnPooledThread(launchReader)
        else ProgressManager.getInstance().run(object : Task.Modal(null, "Connecting with Tempest", true) {
            override fun run(indicator: ProgressIndicator) {
                job.indicator = indicator; job.modality = indicator.modalityState
                indicator.isIndeterminate = true
                indicator.text = "Connecting to the saved server…"
                ApplicationManager.getApplication().executeOnPooledThread(launchReader)
                try {
                    while (!job.finished.await(100, TimeUnit.MILLISECONDS)) indicator.checkCanceled()
                    indicator.checkCanceled()
                } catch (cancelled: ProcessCanceledException) {
                    job.cancelled = true; job.process?.destroy()
                    throw cancelled
                }
            }
            override fun onCancel() { if (active === job) cancelJob() }
            override fun onSuccess() {
                if (!disposed && active === job) {
                    active = null; busy(false)
                    if (job.failure != null) {
                        Messages.showErrorDialog(this@ConnectionPanel, job.failure!!, "Tempest Remote")
                        return
                    }
                    job.gateway?.let { gateway ->
                        val config = SshConfig.create(false, gateway["host"].asString, gateway["port"].asInt,
                            gateway["user"].asString, AuthType.KEY_PAIR, gateway["identityFile"].asString)
                        config.setCustomName("Tempest · ${gateway["label"].asString}")
                        config.isOpenSshConfigUsageForced = false
                        config.connectionConfigPatch = SshConnectionConfigPatch().apply {
                            hostKeyVerifier = SshConnectionConfigPatch.HostKeyVerifier(false,
                                SshConnectionConfigPatch.HostKeyVerifier.StrictHostKeyChecking.YES)
                        }
                        val manager = SshConfigManager.getInstance(null)
                        val configurations = manager.lastSavedAndCurrentData.currentData.toMutableList()
                        val existing = configurations.indexOfFirst { it.config.customName == config.customName && it.config.keyPath == config.keyPath }
                        if (existing >= 0) {
                            config.id = configurations[existing].config.id
                            configurations[existing] = SshUiData(config)
                        } else configurations.add(SshUiData(config))
                        manager.applyData(configurations, null)
                        log.info("Tempest direct SSH configuration ready on loopback port ${config.port}; opening Gateway SSH wizard")
                        onConnected()
                    }
                }
            }
        })
    }
    private fun runHelper(job: Job, args: List<String>, nodePath: String, cliPath: String) {
        val loading = job.loading
        var failure: String? = null
        var delivered = false
        try {
            val command = listOf(nodePath, helper.resolve("scripts/remote.js").toString(), "--cli-path", cliPath, "--prompt-json") + args
            val commandLine = GeneralCommandLine(command)
                .withParentEnvironmentType(GeneralCommandLine.ParentEnvironmentType.CONSOLE)
                .withCharset(Charsets.UTF_8)
            // Resolve against the IDE's shell PATH before Java launches the executable.
            PathEnvironmentVariableUtil.findInPath(nodePath, commandLine.effectiveEnvironment["PATH"], null)
                ?.let { commandLine.exePath = it.absolutePath }
            val process = commandLine.createProcess()
            job.process = process; service<Connections>().add(process)
            if (disposed || job.cancelled) { process.destroy(); return }
            ApplicationManager.getApplication().executeOnPooledThread {
                runCatching { process.errorStream.use { it.transferTo(java.io.OutputStream.nullOutputStream()) } }
            }
            val writer = process.outputStream.bufferedWriter()
            process.inputStream.bufferedReader().useLines { lines ->
                lines.forEach { line ->
                    if (line.length > 1024 * 1024) { process.destroy(); error("Oversized response") }
                    val frame = JsonParser.parseString(line).asJsonObject
                    when (frame["type"]?.asString) {
                        "prompt" -> {
                            var answer: JsonObject? = null
                            ApplicationManager.getApplication().invokeAndWait({
                                if (!disposed && active === job && !job.cancelled) answer = prompt(frame.getAsJsonObject("prompt"))
                            }, job.modality)
                            if (answer == null) { job.cancelled = true; process.destroy() }
                            else { writer.write(answer.toString()); writer.newLine(); writer.flush() }
                        }
                        "progress" -> {
                            val message = frame["message"].asString
                            job.indicator?.text = message
                        }
                        "servers" -> {
                            val entries = frame.getAsJsonArray("servers").map { it.asJsonObject }.map { Server(it["id"].asString, it["label"].asString, it["description"]?.asString) }
                            delivered = true
                            ui(job) {
                                val previous = (servers.selectedItem as? Server)?.id
                                servers.removeAllItems(); entries.forEach { servers.addItem(it) }
                                servers.selectedItem = entries.find { it.id == previous }
                                servers.toolTipText = if (entries.isEmpty()) "No saved SSH servers. Add a server in Tempest, then Refresh." else "${entries.size} saved servers"
                                log.debug("Tempest server list updated: ${entries.size} entries")
                            }
                        }
                        "error" -> failure = frame["message"]?.asString ?: "Tempest could not complete the request."
                        "connected" -> {
                            val gateway = frame.getAsJsonObject("gateway")
                            require(gateway != null && gateway["port"].asInt in 1..65535)
                            require(gateway["host"].asString == "127.0.0.1")
                            // Use Gateway's SSH library for key parsing and known-hosts storage.
                            val key = Buffer.PlainBuffer(Base64.getDecoder().decode(
                                gateway["hostKey"].asString.trim().split(Regex("\\s+"))[1])).readPublicKey()
                            val hostsFile = OpenSSHKnownHosts.detectSSHDir().resolve("known_hosts")
                            Files.createDirectories(hostsFile.parentFile.toPath())
                            val hosts = OpenSSHKnownHosts(hostsFile)
                            val port = gateway["port"].asInt
                            if (!hosts.verify("127.0.0.1", port, key)) {
                                hosts.write(OpenSSHKnownHosts.HostEntry(null, "[127.0.0.1]:$port", KeyType.fromKey(key), key))
                            }
                            delivered = true; job.gateway = gateway
                        }
                    }
                }
            }
            val code = process.waitFor()
            if (code != 0 && !job.cancelled && failure == null) failure = "Tempest could not complete the request. Check sign-in and retry."
            if (!delivered && failure == null && !job.cancelled) failure = "Tempest returned no connection data. Check your CLI version and retry."
        } catch (error: Exception) {
            if (!job.cancelled) log.warn("Tempest helper request failed: ${error.javaClass.simpleName}")
            if (!job.cancelled) failure = "Cannot run the Tempest helper. Check executable paths in Advanced settings and retry."
        } finally {
            job.failure = if (job.cancelled) null else failure
            job.finished.countDown()
            job.process?.let { service<Connections>().remove(it); it.destroy() }
            if (loading) ui(job) {
                active = null; busy(false)
                job.failure?.let { Messages.showErrorDialog(this, it, "Tempest Remote") }
            }
        }
    }

    private fun cancelJob() {
        val job = active ?: return
        job.cancelled = true; job.process?.destroy()
        active = null; busy(false)
    }
    private fun prompt(frame: JsonObject): JsonObject? {
        val message = frame["message"].asString
        val answer = JsonObject(); answer.addProperty("id", frame["id"].asString)
        when (frame["kind"].asString) {
            "password" -> answer.addProperty("answer", Messages.showPasswordDialog(message, "Tempest Authentication") ?: return null)
            "text" -> answer.addProperty("answer", Messages.showInputDialog(message, "Tempest Authentication", null) ?: return null)
            "confirm" -> { if (Messages.showYesNoDialog(message, "Tempest Authentication", null) != Messages.YES) return null; answer.addProperty("answer", true) }
            "select" -> {
                val choices = frame.getAsJsonArray("choices").map { it.asJsonObject }
                val selected = JOptionPane.showInputDialog(this, message, "Tempest Authentication", JOptionPane.QUESTION_MESSAGE, null,
                    choices.map { Server(it["id"].asString, it["label"].asString, it["description"]?.asString) }.toTypedArray(), null) as? Server ?: return null
                answer.addProperty("answer", selected.id)
            }
            else -> return null
        }
        return answer
    }
    override fun dispose() {
        disposed = true
        active?.let { it.cancelled = true; it.process?.destroy() }
    }
    private fun extractHelper(): Path {
        val root = Files.createTempDirectory("tempest-remote-")
        root.toFile().deleteOnExit()
        for (directory in listOf("scripts", "lib")) {
            Files.createDirectories(root.resolve(directory)).toFile().deleteOnExit()
        }
        for (file in listOf("scripts/remote.js", "scripts/clients.js", "lib/remote-sdk.cjs", "lib/REMOTE-SDK-LICENSE")) {
            val output = root.resolve(file); Files.createDirectories(output.parent)
            javaClass.getResourceAsStream("/helper/$file").use { input -> requireNotNull(input); Files.copy(input, output) }
            output.toFile().deleteOnExit()
        }
        return root
    }
}
