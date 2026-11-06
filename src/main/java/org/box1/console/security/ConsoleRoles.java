package org.box1.console.security;

import java.util.List;

/** Client roles on the Keycloak client {@code operations-console} (decision D-002). Every check is in the backend. */
public final class ConsoleRoles {
    public static final String VIEWER = "console-viewer";
    public static final String OPERATOR = "console-operator";
    public static final String DEVELOPER = "console-developer";
    public static final List<String> ALL = List.of(VIEWER, OPERATOR, DEVELOPER);

    private ConsoleRoles() {
    }
}
