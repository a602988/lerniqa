/**
 * Returns true when following a Drawer link would replace the current route.
 * Hash-only movement stays inside the same rendered form and does not discard it.
 */
export function leavesCurrentDrawerRoute(
    currentHref: string,
    destinationHref: string,
): boolean {
    const current = new URL(currentHref);
    const destination = new URL(destinationHref, current);
    return destination.origin !== current.origin
        || destination.pathname !== current.pathname
        || destination.search !== current.search;
}
