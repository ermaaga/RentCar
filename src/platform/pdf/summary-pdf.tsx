import { join } from "node:path";

import { createLimiter, withTimeout } from "../concurrency/limiter";
import { Document, Font, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";

// PdfRenderer (docs/06-backend-api.md 10.1 step 3, ADR-0006, SR-PDF-01/03): lays out preformatted
// text only. Fonts are embedded from files shipped with the app (assets/fonts, SIL OFL), so rendering
// never touches the network; no Image or Link from data. At most 2 renders run at once and each one
// has a 5 s budget; the caller maps a failure to PDF_UNAVAILABLE.

export interface SummaryDocument {
  title: string;
  tenantName: string;
  tenantContact: string;
  codeLabel: string;
  code: string;
  rows: readonly (readonly [string, string])[];
  notes: readonly string[];
}

const FAMILY = "Noto Sans";
const FONT_DIR = join(process.cwd(), "assets", "fonts");
const MAX_CONCURRENT = 2;
const TIMEOUT_MS = 5_000;

let fontsReady = false;
function registerFonts(): void {
  if (fontsReady) return;
  Font.register({
    family: FAMILY,
    fonts: [
      { src: join(FONT_DIR, "NotoSans-Regular-latin.woff"), fontWeight: 400 },
      { src: join(FONT_DIR, "NotoSans-Bold-latin.woff"), fontWeight: 700 },
    ],
  });
  // Whole words only: the default hyphenation would split names and codes.
  Font.registerHyphenationCallback((word) => [word]);
  fontsReady = true;
}

const styles = StyleSheet.create({
  page: { fontFamily: FAMILY, fontSize: 11, padding: 48, color: "#111111" },
  tenant: { fontSize: 16, fontWeight: 700 },
  muted: { color: "#444444", marginTop: 2 },
  title: { fontSize: 20, fontWeight: 700, marginTop: 28, marginBottom: 12 },
  codeBox: { borderWidth: 1, borderColor: "#111111", padding: 12, marginBottom: 20 },
  code: { fontSize: 22, fontWeight: 700, letterSpacing: 2, marginTop: 4 },
  row: { flexDirection: "row", paddingVertical: 5, borderBottomWidth: 0.5, borderColor: "#999999" },
  label: { width: "40%", color: "#444444" },
  value: { width: "60%", fontWeight: 700 },
  note: { marginTop: 8 },
});

function SummaryPdf({ doc }: { doc: SummaryDocument }) {
  return (
    <Document
      title={doc.title}
      author={doc.tenantName}
      creator={doc.tenantName}
      producer={doc.tenantName}
    >
      <Page size="A4" style={styles.page}>
        <Text style={styles.tenant}>{doc.tenantName}</Text>
        <Text style={styles.muted}>{doc.tenantContact}</Text>
        <Text style={styles.title}>{doc.title}</Text>
        <View style={styles.codeBox}>
          <Text>{doc.codeLabel}</Text>
          <Text style={styles.code}>{doc.code}</Text>
        </View>
        {doc.rows.map(([label, value]) => (
          <View key={label} style={styles.row}>
            <Text style={styles.label}>{label}</Text>
            <Text style={styles.value}>{value}</Text>
          </View>
        ))}
        <View style={{ marginTop: 16 }}>
          {doc.notes.map((note) => (
            <Text key={note} style={styles.note}>
              {note}
            </Text>
          ))}
        </View>
      </Page>
    </Document>
  );
}

const limiter = createLimiter(MAX_CONCURRENT);

/** Renders the one-page summary; throws on failure or timeout. */
export async function renderSummaryPdf(doc: SummaryDocument): Promise<Buffer> {
  registerFonts();
  return limiter.run(() => withTimeout(renderToBuffer(<SummaryPdf doc={doc} />), TIMEOUT_MS));
}
