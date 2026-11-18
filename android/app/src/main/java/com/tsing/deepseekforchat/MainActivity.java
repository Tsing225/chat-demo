package com.tsing.deepseekforchat;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Manually register the in-app APK installer plugin before the bridge is created.
        // cap sync only scans node_modules for plugins, so this registration cannot be wiped.
        registerPlugin(ApkInstallerPlugin.class);
        // Same manual registration for the system font scale reader (FontScalePlugin).
        registerPlugin(FontScalePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
