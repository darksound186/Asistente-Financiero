package com.darksound186.asistentefinanciero;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.text.InputType;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import java.time.Instant;
import java.util.regex.Pattern;

public final class ReviewExpenseActivity extends Activity {
    private static final long MAX_AMOUNT = 100_000_000L;
    private static final Pattern CAPTURE_ID = Pattern.compile("^[a-f0-9]{64}$");
    private static final String[] TYPE_LABELS = {
            "Compra o pago", "Transferencia enviada", "Transferencia recibida", "Transferencia (sentido incierto)",
            "Ingreso", "Devolución o reverso", "Notificación informativa", "Operación desconocida"
    };
    private static final String[] TYPE_VALUES = {
            NotificationParser.TYPE_PURCHASE, NotificationParser.TYPE_TRANSFER_SENT,
            NotificationParser.TYPE_TRANSFER_RECEIVED, NotificationParser.TYPE_TRANSFER_UNKNOWN,
            NotificationParser.TYPE_INCOME, NotificationParser.TYPE_REFUND,
            NotificationParser.TYPE_INFORMATIONAL, NotificationParser.TYPE_UNKNOWN
    };

    private String captureId;
    private String source;
    private boolean sourceVerified;
    private long occurredAt;
    private EditText amountField;
    private EditText descriptionField;
    private Spinner typeSpinner;
    private Button continueButton;

    static boolean isKnownType(String type) {
        if (type == null) return false;
        for (String value : TYPE_VALUES) if (value.equals(type)) return true;
        return false;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Intent intent = getIntent();
        captureId = intent.getStringExtra(SaveExpenseReceiver.EXTRA_CAPTURE_ID);
        source = intent.getStringExtra(SaveExpenseReceiver.EXTRA_SOURCE);
        sourceVerified = intent.getBooleanExtra(SaveExpenseReceiver.EXTRA_SOURCE_VERIFIED, false);
        occurredAt = intent.getLongExtra(SaveExpenseReceiver.EXTRA_OCCURRED_AT, 0);
        long amount = intent.getLongExtra(SaveExpenseReceiver.EXTRA_AMOUNT, 0);
        String description = intent.getStringExtra(SaveExpenseReceiver.EXTRA_DESCRIPTION);
        String suggestedType = intent.getStringExtra(SaveExpenseReceiver.EXTRA_SUGGESTED_TYPE);
        if (!isValidCapture(amount, description, suggestedType)) {
            Toast.makeText(this, "El movimiento detectado no pasó la validación.", Toast.LENGTH_LONG).show();
            finish();
            return;
        }
        showReviewForm(amount, description, suggestedType);
    }

    private boolean isValidCapture(long amount, String description, String suggestedType) {
        return captureId != null && CAPTURE_ID.matcher(captureId).matches() &&
                ExpenseSources.isKnownProvider(source) && amount > 0 && amount <= MAX_AMOUNT &&
                occurredAt > 0 && description != null && !description.trim().isEmpty() &&
                description.length() <= 200 && isKnownType(suggestedType) &&
                (sourceVerified || NotificationParser.TYPE_UNKNOWN.equals(suggestedType));
    }

    private void showReviewForm(long amount, String description, String suggestedType) {
        LinearLayout form = new LinearLayout(this);
        form.setOrientation(LinearLayout.VERTICAL);
        int padding = dp(20);
        form.setPadding(padding, padding, padding, padding);

        TextView heading = new TextView(this);
        heading.setText("Revisa el movimiento antes de guardarlo");
        heading.setTextSize(20);
        form.addView(heading);

        TextView provider = new TextView(this);
        provider.setText(sourceVerified
                ? "Origen verificado: " + source
                : "Posible origen: " + source + " (firma de la app no verificada)");
        provider.setPadding(0, dp(12), 0, dp(8));
        form.addView(provider);

        TextView amountLabel = new TextView(this);
        amountLabel.setText("Importe en pesos (puedes corregirlo)");
        form.addView(amountLabel);
        amountField = new EditText(this);
        amountField.setInputType(InputType.TYPE_CLASS_NUMBER);
        amountField.setText(String.valueOf(amount));
        amountField.setSelectAllOnFocus(true);
        form.addView(amountField);

        TextView descriptionLabel = new TextView(this);
        descriptionLabel.setText("Descripción (puedes editarla)");
        descriptionLabel.setPadding(0, dp(8), 0, 0);
        form.addView(descriptionLabel);
        descriptionField = new EditText(this);
        descriptionField.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
        descriptionField.setText(description.trim());
        descriptionField.setSingleLine(false);
        form.addView(descriptionField);

        TextView typeLabel = new TextView(this);
        typeLabel.setText("Tipo de operación detectado");
        typeLabel.setPadding(0, dp(8), 0, 0);
        form.addView(typeLabel);
        typeSpinner = new Spinner(this);
        typeSpinner.setAdapter(new ArrayAdapter<>(this,
                android.R.layout.simple_spinner_dropdown_item, TYPE_LABELS));
        typeSpinner.setSelection(indexOf(suggestedType));
        typeSpinner.setOnItemSelectedListener(new android.widget.AdapterView.OnItemSelectedListener() {
            @Override
            public void onItemSelected(android.widget.AdapterView<?> parent,
                                       android.view.View view, int position, long id) {
                updateContinueButton();
            }

            @Override
            public void onNothingSelected(android.widget.AdapterView<?> parent) {
                updateContinueButton();
            }
        });
        form.addView(typeSpinner);

        TextView guidance = new TextView(this);
        guidance.setText("Transferencias, ingresos, devoluciones y tipos inciertos no se guardan automáticamente como gastos. Revísalos manualmente.");
        guidance.setPadding(0, dp(8), 0, dp(8));
        form.addView(guidance);

        continueButton = new Button(this);
        continueButton.setOnClickListener(view -> continueWithReview());
        form.addView(continueButton);

        Button openManually = new Button(this);
        openManually.setText("Abrir Billetera sin guardar");
        openManually.setOnClickListener(view -> openMainActivity(null));
        form.addView(openManually);

        setContentView(form, new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        updateContinueButton();
    }

    private void updateContinueButton() {
        if (continueButton == null || typeSpinner == null) return;
        continueButton.setText(NotificationParser.TYPE_PURCHASE.equals(selectedType())
                ? "Confirmar como gasto y guardar"
                : "Revisar manualmente en Billetera");
    }

    private void continueWithReview() {
        if (!NotificationParser.TYPE_PURCHASE.equals(selectedType())) {
            Toast.makeText(this, "No se guardó automáticamente como gasto.", Toast.LENGTH_LONG).show();
            openMainActivity(null);
            return;
        }
        long amount;
        try {
            amount = Long.parseLong(amountField.getText().toString().trim());
        } catch (NumberFormatException error) {
            amount = 0;
        }
        String description = descriptionField.getText().toString().trim();
        if (amount <= 0 || amount > MAX_AMOUNT || description.isEmpty() || description.length() > 200) {
            Toast.makeText(this, "Corrige el importe y escribe una descripción breve.", Toast.LENGTH_LONG).show();
            return;
        }
        openMainActivity(new ExpenseReview(captureId, amount, source, occurredAt, description));
    }

    private void openMainActivity(ExpenseReview review) {
        Intent open = new Intent(this, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (review != null) {
            open.putExtra(SaveExpenseReceiver.EXTRA_CAPTURE_ID, review.captureId)
                    .putExtra(SaveExpenseReceiver.EXTRA_AMOUNT, review.amount)
                    .putExtra(SaveExpenseReceiver.EXTRA_SOURCE,
                            sourceVerified ? review.source : ExpenseSources.unverifiedLabel(review.source))
                    .putExtra(SaveExpenseReceiver.EXTRA_OCCURRED_AT, Instant.ofEpochMilli(review.occurredAt).toString())
                    .putExtra(SaveExpenseReceiver.EXTRA_DESCRIPTION, review.description);
        }
        startActivity(open);
        finish();
    }

    private String selectedType() {
        int index = typeSpinner.getSelectedItemPosition();
        return index >= 0 && index < TYPE_VALUES.length ? TYPE_VALUES[index] : NotificationParser.TYPE_UNKNOWN;
    }

    private int indexOf(String type) {
        for (int i = 0; i < TYPE_VALUES.length; i++) if (TYPE_VALUES[i].equals(type)) return i;
        return TYPE_VALUES.length - 1;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private static final class ExpenseReview {
        final String captureId;
        final long amount;
        final String source;
        final long occurredAt;
        final String description;

        ExpenseReview(String captureId, long amount, String source, long occurredAt, String description) {
            this.captureId = captureId;
            this.amount = amount;
            this.source = source;
            this.occurredAt = occurredAt;
            this.description = description;
        }
    }
}
