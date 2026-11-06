package org.box1.console.domain;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;

import org.box1.console.api.Views.Incident;
import org.box1.console.upstream.Payloads.UpOrder;

/**
 * Incidents derived from order-service observations until an incident contract exists (#17, decision D-012).
 * An incident is active only while the order service still reports the qualifying state.
 */
public final class Incidents {
    public static final String PREFIX = "inc_";

    private Incidents() {
    }

    public static String idFor(String orderId) {
        return PREFIX + orderId;
    }

    public static Optional<String> orderIdOf(String incidentId) {
        return incidentId != null && incidentId.startsWith(PREFIX + "ord_")
            ? Optional.of(incidentId.substring(PREFIX.length())) : Optional.empty();
    }

    public static boolean stuck(UpOrder order, Duration threshold, Instant now) {
        return "FULFILLMENT_REQUESTED".equals(order.state()) && order.updatedAt() != null
            && order.updatedAt().plus(threshold).isBefore(now);
    }

    /** The incident this order currently raises, if any. */
    public static Optional<Incident> derive(UpOrder order, Duration threshold, Instant now) {
        if ("EXCEPTION".equals(order.state())) {
            String reason = order.statusReason() == null ? "" : " (" + order.statusReason() + ")";
            return Optional.of(new Incident(idFor(order.orderId()), order.orderId(), "ORDER_EXCEPTION",
                "Manual reconciliation required" + reason, order.updatedAt(), true, true));
        }
        if (stuck(order, threshold, now)) {
            long minutes = Duration.between(order.updatedAt(), now).toMinutes();
            return Optional.of(new Incident(idFor(order.orderId()), order.orderId(), "AWAITING_ERP_TOO_LONG",
                StateLabels.AWAITING_ERP + " for " + minutes + " min", order.updatedAt(), true, true));
        }
        return Optional.empty();
    }

    /**
     * For an evidence page: the incident as it stands now. It is inactive only when the order service reports a state
     * past the incident; an order still awaiting the ERP stays active even below the threshold.
     */
    public static Incident current(UpOrder order, Duration threshold, Instant now) {
        Optional<Incident> derived = derive(order, threshold, now);
        if (derived.isPresent()) {
            return derived.get();
        }
        if ("FULFILLMENT_REQUESTED".equals(order.state())) {
            long minutes = order.updatedAt() == null ? 0 : Duration.between(order.updatedAt(), now).toMinutes();
            return new Incident(idFor(order.orderId()), order.orderId(), "AWAITING_ERP_TOO_LONG",
                StateLabels.AWAITING_ERP + " for " + minutes + " min (below the " + threshold.toMinutes()
                    + " min threshold)", order.updatedAt(), true, true);
        }
        return new Incident(idFor(order.orderId()), order.orderId(), "ORDER_EXCEPTION",
            "No longer active: the order service reports " + StateLabels.label(order.state()), order.updatedAt(), false, true);
    }
}
