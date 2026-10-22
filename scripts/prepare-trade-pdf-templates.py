"""Build PDF overlays from the supplied, already rendered Office templates.

The original Office files are never modified. Coordinates use PDF top-left points.
Run with the bundled Python after converting the copies under tmp/trade-documents.
"""
import base64
import json
from pathlib import Path
from zipfile import ZipFile
import pymupdf as pdf

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / "tmp/trade-documents"
SOURCE = Path("/Users/jingwu/Desktop/Yifun Life/Company Details/Contracts")
result = {}


def field(key, rect, page=0, size=9, text=None):
    return dict(key=key, rect=rect, page=page, size=size, **({"text": text} if text else {}))


def finish(kind, document, fields):
    result[kind] = {"pdf": base64.b64encode(document.tobytes(garbage=4, deflate=True)).decode(), "fields": fields}


for kind, filename in [("equipment-pi", "PI/HK USD PI Equipment Purchase.xlsx"), ("equipment-ci", "CI/HK-USD CI Equipment Purchase.xlsx")]:
    doc = pdf.open(WORK / (kind + ".pdf"))
    p = doc[0]
    # Remove unsupported DISPIMG's cached formula display, then restore the exact
    # embedded source image, without touching the title or other template content.
    for block in p.get_text("blocks"):
        if "7634421D5E459D8B325" in block[4]:
            p.add_redact_annot(pdf.Rect(block[:4]), fill=(1, 1, 1))
    p.apply_redactions(images=0, graphics=0)
    with ZipFile(SOURCE / filename) as archive:
        logo = archive.read("xl/media/image1.png")
    p.insert_image(pdf.Rect(54, 75, 164 if kind == "equipment-pi" else 133, 113), stream=logo, keep_proportion=True)
    if kind == "equipment-pi":
        fields = [field("number", [606, 119, 748, 130]), field("date", [606, 130, 748, 141]), field("origin", [606, 141, 748, 152]), field("destination", [606, 152, 748, 164]),
                  field("sellerName", [123, 173, 401, 186], size=8), field("sellerContact", [104, 187, 400, 199]), field("sellerEmail", [104, 200, 400, 212]), field("sellerPhone", [104, 213, 400, 225]), field("sellerAddress", [104, 225, 400, 249], size=7),
                  field("buyer", [460, 173, 748, 186]), field("buyerAddress", [407, 187, 748, 212]), field("buyerContact", [495, 213, 748, 225]), field("buyerPhone", [458, 225, 748, 237]), field("buyerEmail", [456, 237, 748, 249]),
                  field("description", [168, 285, 404, 302], size=8), field("summaryQuantity", [407, 285, 496, 302]), field("summaryPrice", [501, 285, 632, 302]), field("total", [638, 285, 748, 302]), field("total", [638, 304, 748, 319])]
    else:
        # The source CI has one summary goods row. Detailed goods are attached as
        # an appendix, so rows never overwrite banking information.
        for text in ["Indoor Playground Equipment", "9506999000"]:
            for rect in p.search_for(text): p.add_redact_annot(rect, fill=(1, 1, 1))
        p.apply_redactions(images=0, graphics=0)
        fields = [field("number", [469, 111, 538, 121], size=7), field("date", [469, 121, 538, 130], size=7), field("origin", [469, 130, 538, 140], size=7), field("destination", [469, 140, 538, 150], size=7),
                  field("sellerName", [117, 157, 336, 169], size=7), field("sellerContact", [94, 177, 336, 186], size=7), field("sellerEmail", [94, 187, 336, 196], size=7), field("sellerPhone", [94, 197, 336, 206], size=7), field("sellerAddress", [94, 206, 336, 226], size=6),
                  field("buyer", [386, 157, 538, 177], size=7), field("buyerContact", [405, 187, 538, 196], size=7), field("buyerPhone", [377, 197, 538, 206], size=7), field("buyerAddress", [381, 206, 538, 226], size=6),
                  field("description", [135.3, 250.5, 275.5, 272.9], size=7), field("summaryHs", [276.8, 250.5, 336, 272.9], size=6), field("summaryQuantity", [337.2, 250.5, 382.7, 272.9], size=7), field("summaryPrice", [383.9, 250.5, 452.8, 272.9], size=7), field("total", [453.9, 250.5, 532.9, 272.9], size=7), field("total", [453.9, 274, 532.9, 284.9], size=7)]
    unit_matches = p.search_for("EXW 单价")
    if unit_matches:
        r = pdf.Rect(unit_matches[0])
        for part in unit_matches[1:]: r |= part
        fields.append(field("unitPriceLabel", [r.x0, r.y0, r.x1 + 8, r.y1 + 1], size=6 if kind == "equipment-ci" else 8))
        p.add_redact_annot(r, fill=(1, 1, 1))
    # Amount cache and summary cells are cleared in the retained base too.
    for item in fields:
        if item["key"] in ["total", "summaryQuantity", "summaryPrice", "description", "summaryHs"]:
            p.add_redact_annot(pdf.Rect(item["rect"]), fill=(1, 1, 1))
    p.apply_redactions(images=0, graphics=0)
    finish(kind, doc, fields)

doc = pdf.open(WORK / "design-pi.pdf")
p = doc[0]
fields = [field("buyer", [386, 113, 536, 126], size=8), field("buyerAddress", [387, 145, 536, 172], size=7), field("buyerEmail", [386, 172, 537, 183], size=7), field("number", [102, 193, 330, 204], size=8), field("date", [102, 204, 330, 215], size=8), field("validUntil", [102, 215, 330, 225], size=8), field("description", [106.3, 282.6, 341.4, 292.1], size=7), field("summaryQuantity", [399.4, 282.6, 430.3, 292.1], size=7), field("summaryPrice", [431.4, 282.6, 494.2, 292.1], size=7), field("total", [495.3, 282.6, 535.9, 292.1], size=7), field("total", [495.3, 303.7, 535.9, 313.3], size=7)]
fields += [field("bankAddressLabel", [54.3, 368.1, 105.0, 377.5], size=5.5, text="BENE ADDRESS:"), field("bankAddress", [106.3, 368.1, 535.9, 377.5], size=6, text="Cnr Middle & Bloomfield Street, Cleveland, Queensland 4163 Australia"), field("bankNameLabel", [54.3, 378.7, 105.0, 388.0], size=5.5, text="BENE BANK NAME:"), field("bankName", [106.3, 378.7, 535.9, 388.0], size=6, text="WESTPAC BANKING CORPORATION")]
for item in fields: p.add_redact_annot(pdf.Rect(item["rect"]), fill=(1, 1, 1))
p.apply_redactions(images=0, graphics=0)
finish("design-pi", doc, fields)

doc = pdf.open(WORK / "HK Yifun Life - Playground Equipment Contract V4.pdf")
fields = []
# Label fields retain all original paragraphs and signature lines. Signatures and
# legal representative signatures remain deliberately blank for actual signing.
for key, label in [("number", "Contract No.:"), ("date", "Date of Signing:"), ("projectName", "Project Name:"), ("projectAddress", "Project Address:")]:
    r = doc[0].search_for(label)[0]
    fields.append(field(key, [r.x1 + 8, r.y0, 540, r.y1 + 3], 0, 10))
for key, label in [("buyer", "Name:"), ("buyerAddress", "Address:"), ("buyerContact", "Contact Person / Authorized Representative:"), ("buyerEmail", "Email:")]:
    r = doc[1].search_for(label)[0]
    fields.append(field(key, [r.x1 + 8, r.y0, 540, r.y1 + 3], 1, 10))
for page_index, p in enumerate(doc):
    for block in p.get_text("blocks"):
        text = block[4].strip()
        key = None
        if "as Appendix [●]" in text: key = "appendixParagraph"
        if "total contract price for this project" in text: key = "priceParagraph"
        if "4.1 Within three" in text: key = "depositParagraph"
        if "4.2 Upon completion" in text: key = "balanceParagraph"
        if text.startswith("dispatch only after receipt"): key = "dispatchParagraph"
        if text.startswith("Party B shall not be responsible for arranging transportation"): key = "transportParagraph"
        if text.startswith("Party B’s assistance in arranging logistics"): key = "logisticsParagraph"
        if text.startswith("Unless otherwise agreed in writing, Party A shall be responsible"): key = "unloadingParagraph"
        if "delivery lead time shall be ______" in text: key = "deliveryParagraph"
        if "option (to be agreed" in text: key = "installationParagraph"
        if key:
            rect = list(block[:4])
            if key == "balanceParagraph": rect[3] = min(765, rect[3] + 10)
            if key == "depositParagraph": rect[3] += 8
            fields.append(field(key, rect, page_index, 10, text))
            p.add_redact_annot(pdf.Rect(block[:4]), fill=(1, 1, 1))
    # Fill only the explicit blanks in the installation table.
    for label, key in [("Estimated ___ calendar days", "installationEstimate"), ("USD________", "installationAmount")]:
        matches = p.search_for(label)
        groups = [[r for r in matches if r.x0 < 345], [r for r in matches if r.x0 >= 345]]
        for index, group in enumerate(groups):
            if not group: continue
            r = pdf.Rect(group[0])
            for part in group[1:]: r |= part
            fields.append(field(("guidanceDays" if index == 0 else "installationDays") if key == "installationEstimate" else ("guidanceFee" if index == 0 else "installationFee"), [r.x0, r.y0, r.x1 + 3, r.y1 + 2], page_index, 9))
            p.add_redact_annot(r, fill=(1, 1, 1))
    # Named service contacts are business fields, not signatures.
    for label, key in [("Winnie WU", "sellerContact"), ("yifunlife@hotmail.com", "sellerEmail")]:
        matches = p.search_for(label)
        if matches:
            r = pdf.Rect(matches[0])
            for part in matches[1:]: r |= part
            fields.append(field(key, [r.x0, r.y0, min(540, max(r.x1, r.x0 + 180)), r.y1 + 2], page_index, 9))
            p.add_redact_annot(r, fill=(1, 1, 1))
    p.apply_redactions(images=0, graphics=0)
# Fill identifying details above the client's signature; no signature is forged.
for key, label in [("buyer", "Party A:"), ("buyerAddress", "Address:"), ("buyerContact", "Contact Person:"), ("buyerEmail", "E-mail:"), ("buyerPhone", "Phone:")]:
    r = doc[-1].search_for(label)[0]
    # Preserve the label, erase only its underscore placeholder.
    fields.append(field(key, [r.x1 + 3, r.y0, 540, r.y1 + 2], len(doc) - 1, 9))
    doc[-1].add_redact_annot(pdf.Rect(r.x1 + 3, r.y0, 330, r.y1 + 2), fill=(1, 1, 1))
doc[-1].apply_redactions(images=0, graphics=0)
seller_phone = doc[-1].search_for("Phone:")[1]
fields.append(field("sellerPhone", [seller_phone.x1 + 3, seller_phone.y0, 540, seller_phone.y1 + 2], len(doc) - 1, 9))
finish("equipment-contract", doc, fields)

target = ROOT / "lib/trade-templates/templates.json"
target.parent.mkdir(exist_ok=True)
target.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
print("Prepared:", {key: len(value["fields"]) for key, value in result.items()})
