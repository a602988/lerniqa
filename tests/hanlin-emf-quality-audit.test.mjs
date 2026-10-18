import assert from "node:assert/strict";
import test from "node:test";

import { emfDrawings, pairGifCandidate } from "../scripts/audit-hanlin-english-emf-quality.mjs";

test("EMF quality audit pairs a stored GIF only through its exact HTML image name", () => {
    const documentXml = `
        <w:document><wp:inline>
            <wp:docPr id="29" name="chart-image"/>
            <a:blip r:embed="rId11"/>
        </wp:inline></w:document>`;
    const relationshipsXml = `
        <Relationships>
            <Relationship Id="rId11" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image8.emf"/>
        </Relationships>`;
    const drawings = emfDrawings(documentXml, relationshipsXml);

    assert.deepEqual(drawings, [{ name: "chart-image", relationshipId: "rId11", target: "media/image8.emf" }]);
    assert.deepEqual(pairGifCandidate(
        { derivedChecksum: "derived-chart" },
        [{ name: "chart-image", checksum: "derived-chart" }],
        drawings,
    ), {
        status: "paired",
        image: { name: "chart-image", checksum: "derived-chart" },
        drawing: { name: "chart-image", relationshipId: "rId11", target: "media/image8.emf" },
    });
});

test("EMF quality audit maps an OLE preview by its exact Object sequence", () => {
    const documentXml = `
        <w:document>
            <w:object><v:shape><v:imagedata r:id="rId5"/></v:shape></w:object>
            <w:object><v:shape><v:imagedata r:id="rId7"/></v:shape></w:object>
        </w:document>`;
    const relationshipsXml = `
        <Relationships>
            <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image2.emf"/>
            <Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image3.emf"/>
        </Relationships>`;

    assert.deepEqual(emfDrawings(documentXml, relationshipsXml), [
        { name: "Object1", relationshipId: "rId5", target: "media/image2.emf" },
        { name: "Object2", relationshipId: "rId7", target: "media/image3.emf" },
    ]);
});

test("EMF quality audit refuses ambiguous checksum and image-name matches", () => {
    const candidate = { derivedChecksum: "same" };
    assert.deepEqual(pairGifCandidate(candidate, [
        { name: "first", checksum: "same" },
        { name: "second", checksum: "same" },
    ], []), { status: "inconclusive", reason: "derived-checksum-matches:2" });

    assert.deepEqual(pairGifCandidate(candidate, [{ name: "same-name", checksum: "same" }], [
        { name: "same-name", relationshipId: "r1", target: "media/one.emf" },
        { name: "same-name", relationshipId: "r2", target: "media/two.emf" },
    ]), {
        status: "inconclusive",
        reason: "emf-name-matches:2",
        image: { name: "same-name", checksum: "same" },
    });
});
