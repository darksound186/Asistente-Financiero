package com.darksound186.asistentefinanciero;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;

public final class MainLauncherActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        startActivity(new Intent(this, MainActivity.class));
        finish();
    }
}
