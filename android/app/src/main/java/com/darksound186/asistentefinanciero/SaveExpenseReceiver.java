package com.darksound186.asistentefinanciero;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.widget.Toast;

import java.util.regex.Pattern;

public final class SaveExpenseReceiver extends BroadcastReceiver {
    private static final Pattern CAPTURE_ID = Pattern.compile("^[a-f0-9]{64}$");
    private static final long MAX_AMOUNT = 100_000_000L;
    static final String EXTRA_CAPTURE_ID = "capture_id";
    static final String EXTRA_AMOUNT = "amount";
    static final String EXTRA_SOURCE = "source";
    static final String EXTRA_OCCURRED_AT = "occurred_at";
    static final String EXTRA_DESCRIPTION = "description";
    static final String EXTRA_SUGGESTED_TYPE = "suggested_type";
    static final String EXTRA_SOURCE_VERIFIED = "source_verified";

    @Override
    public void onReceive(Context context, Intent intent) {
        String description = ExpenseNotifications.descriptionFromReply(intent);
        if (description.isEmpty() || description.length() > 200) {
            Toast.makeText(context, "Escribe una descripción breve para revisar el movimiento.", Toast.LENGTH_LONG).show();
            return;
        }

        String captureId = intent.getStringExtra(EXTRA_CAPTURE_ID);
        android.os.Bundle capture = ExpenseNotifications.loadCapture(context, captureId);
        if (capture == null) {
            Toast.makeText(context, "La captura ya no está disponible o no es válida.", Toast.LENGTH_LONG).show();
            return;
        }
        String source = capture.getString(EXTRA_SOURCE);
        long amount = capture.getLong(EXTRA_AMOUNT, 0);
        long occurredAt = capture.getLong(EXTRA_OCCURRED_AT, 0);
        String suggestedType = capture.getString(EXTRA_SUGGESTED_TYPE);
        boolean sourceVerified = capture.getBoolean(EXTRA_SOURCE_VERIFIED, false);
        if (captureId == null || !CAPTURE_ID.matcher(captureId).matches() ||
                !ExpenseSources.isKnownProvider(source) ||
                amount <= 0 || amount > MAX_AMOUNT || occurredAt <= 0 ||
                !ReviewExpenseActivity.isKnownType(suggestedType)) {
            Toast.makeText(context, "No se pudo validar el movimiento detectado.", Toast.LENGTH_LONG).show();
            return;
        }

        Intent review = new Intent(context, ReviewExpenseActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                .putExtra(EXTRA_CAPTURE_ID, captureId)
                .putExtra(EXTRA_AMOUNT, amount)
                .putExtra(EXTRA_SOURCE, source)
                .putExtra(EXTRA_OCCURRED_AT, occurredAt)
                .putExtra(EXTRA_DESCRIPTION, description)
                .putExtra(EXTRA_SUGGESTED_TYPE,
                        sourceVerified ? suggestedType : NotificationParser.TYPE_UNKNOWN)
                .putExtra(EXTRA_SOURCE_VERIFIED, sourceVerified);
        context.startActivity(review);
        ExpenseNotifications.removeCapture(context, captureId);

        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager != null) manager.cancel(captureId.hashCode() & 0x7fffffff);
    }
}
