export interface CatalogRetryEvidence {
    signature: string;
    idempotencyKey: string;
}

export interface CatalogMutationAttempt {
    evidence: CatalogRetryEvidence;
    serializedBody: string;
}

/** Keeps one key for an identical retry, including its HTTP operation and target. */
export function resolveCatalogMutationAttempt(
    current: CatalogRetryEvidence | null,
    method: string,
    endpoint: string,
    body: Readonly<Record<string, unknown>>,
    nextKey: () => string,
): CatalogMutationAttempt {
    const serializedBody = JSON.stringify(body);
    const signature = `${method}\u0000${endpoint}\u0000${serializedBody}`;
    return {
        evidence: current?.signature === signature
            ? current
            : { signature, idempotencyKey: nextKey() },
        serializedBody,
    };
}
