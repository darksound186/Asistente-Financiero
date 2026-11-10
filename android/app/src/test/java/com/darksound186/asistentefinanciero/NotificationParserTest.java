package com.darksound186.asistentefinanciero;

public final class NotificationParserTest {
    public static void main(String[] args) {
        assertType("purchase", NotificationParser.classify("Compra aprobada por $12.500 en Café Azul"));
        assertType("transfer_sent", NotificationParser.classify("Transferencia enviada a Persona A por $9.800"));
        assertType("transfer_received", NotificationParser.classify("Recibiste transferencia de Persona B por $20.000"));
        assertType("transfer_unknown", NotificationParser.classify("Transferencia por $4.200"));
        assertType("income", NotificationParser.classify("Abono recibido por $75.000"));
        assertType("refund", NotificationParser.classify("Reembolso procesado por $12.500"));
        assertType("informational", NotificationParser.classify("Tu saldo disponible es $100.000"));
        assertType("unknown", NotificationParser.classify("Movimiento procesado por $5.000"));

        assertAmount(12500L, NotificationParser.extractUniqueCopAmount("Compra por $12.500"));
        assertAmount(12500L, NotificationParser.extractUniqueCopAmount("Compra por 12.500 COP"));
        assertAmount(null, NotificationParser.extractUniqueCopAmount("Compra por $12.50"));
        assertAmount(null, NotificationParser.extractUniqueCopAmount("Compra $12.500; saldo $80.000"));
        assertAmount(null, NotificationParser.extractUniqueCopAmount("Purchase for USD $12.50"));
        assertAmount(null, NotificationParser.extractUniqueCopAmount("Compra sin importe visible"));
        assertAmount(null, NotificationParser.extractUniqueCopAmount("Compra por $100.000.001"));
    }

    private static void assertType(String expected, String actual) {
        if (!expected.equals(actual)) throw new AssertionError("Expected type " + expected + " but got " + actual);
    }

    private static void assertAmount(Long expected, Long actual) {
        if (expected == null ? actual != null : !expected.equals(actual)) {
            throw new AssertionError("Expected amount " + expected + " but got " + actual);
        }
    }
}
