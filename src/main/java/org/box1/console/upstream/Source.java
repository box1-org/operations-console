package org.box1.console.upstream;

import com.fasterxml.jackson.annotation.JsonValue;

/** The upstreams the console reads. Names match the contract's SourceName. */
public enum Source {
    ORDER_SERVICE("order-service"),
    INVENTORY_SERVICE("inventory-service"),
    FULFILLMENT_ADAPTER("fulfillment-adapter"),
    ASSET_SERVICE("asset-service"),
    SCENARIO_CONTROLLER("scenario-controller");

    private final String id;

    Source(String id) {
        this.id = id;
    }

    @JsonValue
    public String id() {
        return id;
    }
}
