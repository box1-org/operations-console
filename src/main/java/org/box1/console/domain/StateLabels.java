package org.box1.console.domain;

import java.util.Map;

/** Display labels for order-service states. ORDER-STATE.md fixes FULFILLMENT_REQUESTED's label. */
public final class StateLabels {
    public static final String AWAITING_ERP = "Awaiting ERP acknowledgement";
    private static final Map<String, String> LABELS = Map.of(
        "SUBMITTED", "Submitted",
        "RESERVED", "Stock reserved",
        "FULFILLMENT_REQUESTED", AWAITING_ERP,
        "SHIPPED", "Shipped",
        "COMPLETED", "Completed",
        "REJECTED", "Rejected: stock unavailable",
        "EXCEPTION", "Exception: manual reconciliation required",
        "CANCELLED", "Cancelled");

    private StateLabels() {
    }

    public static String label(String state) {
        return state == null ? "Unknown" : LABELS.getOrDefault(state, state);
    }
}
