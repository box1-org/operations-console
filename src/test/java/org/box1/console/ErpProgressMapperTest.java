package org.box1.console;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import org.box1.console.api.Views.ErpProgress;
import org.box1.console.domain.ErpProgressMapper;
import org.box1.console.upstream.Payloads.UpFulfillment;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.api.Test;

/** Decision D-008: every adapter observation maps to exactly one stage; the label never claims more than observed. */
class ErpProgressMapperTest {

    @ParameterizedTest(name = "{0}/{1} -> {2}")
    @CsvSource({
        "QUEUED,AWAITING_ERP,QUEUED,Queued for the ERP,waiting",
        "UPLOADED,AWAITING_ERP,UPLOADED_AWAITING_ACK,'Uploaded, awaiting ERP acknowledgement',waiting",
        "UPLOADED,PENDING,ACCEPTED,Accepted by the ERP,waiting",
        "UPLOADED,HELD,HELD,Held by an ERP operator,waiting",
        "UPLOADED,SHIPPED,SHIPPED,Shipped,done",
        "UPLOADED,REJECTED,REJECTED,Rejected by the ERP,failure",
        "NEEDS_ATTENTION,AWAITING_ERP,NEEDS_ATTENTION,Needs attention,attention",
        "NEEDS_ATTENTION,HELD,NEEDS_ATTENTION,Needs attention,attention",
        "NEEDS_ATTENTION,SHIPPED,SHIPPED,Shipped,done",
    })
    void mapsAdapterFields(String dispatch, String outcome, String stage, String label, String tone) {
        ErpProgress p = ErpProgressMapper.from(new UpFulfillment("ful_1", dispatch, "ACKNOWLEDGED", outcome,
            "NO_ACKNOWLEDGEMENT", 2, 1, 0, null, null), "derived");
        assertEquals(stage, p.stage());
        assertEquals(label, p.label());
        assertEquals(tone, p.tone());
    }

    @Test
    void heldIsWaitingNotFailure() {
        ErpProgress p = ErpProgressMapper.from(new UpFulfillment("ful_1", "UPLOADED", "ACKNOWLEDGED", "HELD", null, 2, 1, 0,
            null, null), "derived");
        assertEquals("waiting", p.tone());
        assertEquals("Waiting, not a failure. The request continues when the ERP operator releases it.", p.detail());
    }

    @Test
    void unknownCombinationIsUnavailableNotGuessed() {
        ErpProgress p = ErpProgressMapper.from(new UpFulfillment("ful_1", "SOMETHING_NEW", "NONE", "AWAITING_ERP", null, 1, 0, 0,
            null, null), "derived");
        assertEquals("UNAVAILABLE", p.stage());
        assertEquals(ErpProgressMapper.UNAVAILABLE_LABEL, p.label());
        assertNull(p.outcome());
    }
}
