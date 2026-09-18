package com.uchiha.radius.provider;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(UchihaNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
