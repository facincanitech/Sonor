package com.facincanitech.sonorhub;

import android.app.UiModeManager;
import android.content.Context;
import android.content.res.Configuration;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Ponte JS <-> informação do aparelho que não muda em runtime (por enquanto
// só "é uma TV?"). Criado pra dar suporte a Fire TV/Android TV: o mesmo APK
// roda nos dois, só troca o CSS pra navegação por D-pad quando isTV vier
// true (ver ".tv-mode" no index-source.html).
@CapacitorPlugin(name = "DeviceInfo")
public class DeviceInfoPlugin extends Plugin {
    @PluginMethod
    public void isTV(PluginCall call) {
        UiModeManager uiModeManager = (UiModeManager) getContext().getSystemService(Context.UI_MODE_SERVICE);
        boolean isTv = uiModeManager != null && uiModeManager.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION;
        JSObject ret = new JSObject();
        ret.put("value", isTv);
        call.resolve(ret);
    }

    // Build da Play Store esconde a assinatura Premium (cobrança direta via
    // Mercado Pago dentro do app não é permitida lá pra conteúdo digital —
    // exigem Google Play Billing) até isso ser resolvido de verdade. Vem do
    // flavor do Gradle (BuildConfig.IS_PLAY_BUILD), não muda em runtime.
    @PluginMethod
    public void isPlayBuild(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("value", BuildConfig.IS_PLAY_BUILD);
        call.resolve(ret);
    }
}
