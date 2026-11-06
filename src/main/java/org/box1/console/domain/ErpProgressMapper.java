package org.box1.console.domain;

import java.util.Optional;
import java.util.Set;

import org.box1.console.api.Views.ErpProgress;
import org.box1.console.upstream.Payloads.UpFulfillment;

/**
 * Maps the fulfillment adapter's dispatch, erpAcknowledgement and outcome to one ERP progress stage (decision D-008).
 * When the adapter did not answer, the result says so and carries no adapter fields; it is never guessed.
 */
public final class ErpProgressMapper {
    /** States in which an ERP request may exist; EXCEPTION included so its adapter detail is shown (review ARCH-3). */
    static final Set<String> FULFILLMENT_STATES = Set.of("FULFILLMENT_REQUESTED", "SHIPPED", "COMPLETED", "EXCEPTION");
    public static final String UNAVAILABLE_LABEL = "ERP detail unavailable";

    private ErpProgressMapper() {
    }

    /** Order is not (yet) at a fulfillment state. */
    public static ErpProgress notApplicable(String linkMode) {
        return simple("NOT_APPLICABLE", "No ERP request yet", "neutral", null, linkMode, null);
    }

    public static ErpProgress unavailable(String detail, String linkMode, String fulfillmentRequestId) {
        return simple("UNAVAILABLE", UNAVAILABLE_LABEL, "unknown", detail, linkMode, fulfillmentRequestId);
    }

    public static ErpProgress notReceived(String linkMode, String fulfillmentRequestId) {
        return simple("NOT_RECEIVED", "Not yet received by the fulfillment adapter", "waiting",
            "The adapter has no record of this request yet.", linkMode, fulfillmentRequestId);
    }

    public static boolean applies(String orderState) {
        return FULFILLMENT_STATES.contains(orderState);
    }

    public static ErpProgress from(UpFulfillment f, String linkMode) {
        String outcome = Optional.ofNullable(f.outcome()).orElse("");
        String dispatch = Optional.ofNullable(f.dispatch()).orElse("");
        String stage;
        String label;
        String tone;
        String detail = null;
        if ("SHIPPED".equals(outcome)) {
            stage = "SHIPPED";
            label = "Shipped";
            tone = "done";
            detail = f.shipmentId() == null ? null : "Shipment " + f.shipmentId();
        } else if ("REJECTED".equals(outcome)) {
            stage = "REJECTED";
            label = "Rejected by the ERP";
            tone = "failure";
        } else if ("NEEDS_ATTENTION".equals(dispatch)) {
            stage = "NEEDS_ATTENTION";
            label = "Needs attention";
            tone = "attention";
            detail = f.needsAttentionReason();
        } else if ("HELD".equals(outcome)) {
            stage = "HELD";
            label = "Held by an ERP operator";
            tone = "waiting";
            detail = "Waiting, not a failure. The request continues when the ERP operator releases it.";
        } else if ("PENDING".equals(outcome)) {
            stage = "ACCEPTED";
            label = "Accepted by the ERP";
            tone = "waiting";
            detail = "Imported by the ERP and waiting for processing.";
        } else if ("AWAITING_ERP".equals(outcome) && "UPLOADED".equals(dispatch)) {
            stage = "UPLOADED_AWAITING_ACK";
            label = "Uploaded, awaiting ERP acknowledgement";
            tone = "waiting";
        } else if ("AWAITING_ERP".equals(outcome) && "QUEUED".equals(dispatch)) {
            stage = "QUEUED";
            label = "Queued for the ERP";
            tone = "waiting";
        } else {
            return unavailable("The adapter reported an unrecognised status (dispatch " + dispatch + ", outcome " + outcome
                + ").", linkMode, f.fulfillmentRequestId());
        }
        return new ErpProgress(stage, label, tone, detail, linkMode, f.fulfillmentRequestId(), f.dispatch(),
            f.erpAcknowledgement(), f.outcome(), f.needsAttentionReason(), f.revision(), f.uploads(), f.resends(),
            f.shipmentId(), f.statusAt());
    }

    private static ErpProgress simple(String stage, String label, String tone, String detail, String linkMode, String id) {
        return new ErpProgress(stage, label, tone, detail, linkMode, id, null, null, null, null, null, null, null, null, null);
    }
}
