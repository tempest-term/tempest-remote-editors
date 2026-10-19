package app.gotempest.remote

import com.intellij.openapi.util.IconLoader
import com.intellij.ide.BrowserUtil
import com.jetbrains.gateway.api.GatewayConnector
import com.jetbrains.gateway.api.GatewayConnectorDocumentation
import com.jetbrains.gateway.api.GatewayConnectorView
import com.jetbrains.gateway.api.GatewayUI
import com.jetbrains.rd.util.lifetime.Lifetime
import javax.swing.Icon
import javax.swing.JComponent

class TempestGatewayConnector : GatewayConnector {
    override val icon: Icon get() = IconLoader.getIcon("/META-INF/pluginIcon.svg", javaClass)
    override fun getConnectorId() = "tempest"
    override fun getTitle() = "Tempest"
    override fun getActionText() = "Connect to server"
    override fun getDescription() = "Open your saved SSH servers in a JetBrains IDE."
    override fun getDocumentationAction() = GatewayConnectorDocumentation(true) {
        BrowserUtil.browse("https://docs.gotempest.app/integrations/tempest-remote-editors#jetbrains")
    }
    override fun createView(lifetime: Lifetime): GatewayConnectorView = object : GatewayConnectorView {
        private val form = ConnectionPanel(
            onBack = { GatewayUI.getInstance().reset() },
            onConnected = { GatewayUI.getInstance().showConnectorView("ssh.connector") },
        )
        init { lifetime.onTermination { form.dispose() } }
        override val component: JComponent get() = form
    }
}
