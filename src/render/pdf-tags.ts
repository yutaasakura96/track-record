/**
 * The structure tree a tagged PDF carries (ISO 32000-1 §14.7–14.8), shared by
 * every PDF the app draws: the English résumé (`./resume-pdf.ts`) and the
 * Japanese documents (`./japanese-pdf.ts`, `./rirekisho-pdf.ts`).
 *
 * A reader that copies by position can take a right-aligned date for a second
 * column; the tree states the reading order outright, as Word's own PDF export
 * does.
 */
import { PDFArray, PDFDict, PDFHexString, PDFName, PDFNumber, PDFOperator, PDFOperatorNames, type PDFDocument, type PDFPage, type PDFRef } from "pdf-lib";

/**
 * A tagged PDF's structure tree (ISO 32000-1 §14.7–14.8): each piece of the
 * page is drawn inside a marked-content sequence with an id, and a tree of
 * elements in reading order names those ids. A paragraph that runs onto the
 * next page holds one id on each.
 */
export class Tags {
  readonly root: PDFRef;
  private readonly tree: PDFRef;
  /** For each page, the element each of its ids belongs to, in id order. */
  private readonly pages = new Map<PDFPage, PDFRef[]>();

  constructor(private readonly pdf: PDFDocument) {
    this.tree = pdf.context.nextRef();
    this.root = pdf.context.register(pdf.context.obj({ Type: "StructElem", S: "Document", P: this.tree, K: [] }));
  }

  /** A new element, last among its parent's children. `alt` is a figure's text equivalent. */
  element(role: string, parent: PDFRef, alt?: string): PDFRef {
    const ref = this.pdf.context.register(
      this.pdf.context.obj({ Type: "StructElem", S: role, P: parent, K: [], ...(alt ? { Alt: PDFHexString.fromText(alt) } : {}) }),
    );
    this.kids(parent).push(ref);
    return ref;
  }

  /** Draws content that belongs to `element`. */
  mark(page: PDFPage, element: PDFRef, draw: () => void) {
    const parents = this.pages.get(page) ?? [];
    this.pages.set(page, parents);
    const id = parents.length;
    parents.push(element);
    const role = this.pdf.context.lookup(element, PDFDict).get(PDFName.of("S")) as PDFName;
    page.pushOperators(
      // The property list is written as it stands: an operator takes no dictionary.
      PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [role, `<< /MCID ${id} >>`]),
    );
    draw();
    page.pushOperators(PDFOperator.of(PDFOperatorNames.EndMarkedContent));
    this.kids(element).push(this.pdf.context.obj({ Type: "MCR", Pg: page.ref, MCID: id }));
  }

  /** Draws decoration a reader skips. */
  artifact(page: PDFPage, draw: () => void) {
    page.pushOperators(PDFOperator.of(PDFOperatorNames.BeginMarkedContent, [PDFName.of("Artifact")]));
    draw();
    page.pushOperators(PDFOperator.of(PDFOperatorNames.EndMarkedContent));
  }

  /** Writes the tree, each page's entry in the parent tree, and the flag that says the file is tagged. */
  finish() {
    const { context, catalog } = this.pdf;
    const nums: (number | PDFRef[])[] = [];
    this.pdf.getPages().forEach((page, index) => {
      page.node.set(PDFName.of("StructParents"), PDFNumber.of(index));
      nums.push(index, this.pages.get(page) ?? []);
    });
    context.assign(
      this.tree,
      context.obj({
        Type: "StructTreeRoot",
        K: this.root,
        ParentTree: context.register(context.obj({ Nums: nums })),
        ParentTreeNextKey: this.pdf.getPageCount(),
      }),
    );
    catalog.set(PDFName.of("StructTreeRoot"), this.tree);
    catalog.set(PDFName.of("MarkInfo"), context.obj({ Marked: true }));
  }

  private kids(element: PDFRef): PDFArray {
    return this.pdf.context.lookup(element, PDFDict).get(PDFName.of("K")) as PDFArray;
  }
}
