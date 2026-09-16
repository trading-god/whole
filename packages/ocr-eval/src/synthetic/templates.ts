// A `ScreenSpec` rendered as the HTML one screenshot is taken of.
//
// These are deliberately plain: a phone-width page, system fonts, the chrome a
// real capture carries (status bar, tab bar, section headers, captions). The
// engine reads TEXT and box geometry, so what a template has to get right is
// where words sit relative to each other — the thing that decides whether a
// figure belongs to the account above it or the one below. Colour, iconography
// and brand styling reach the pipeline through nothing at all, and a template
// that imitated a real bank's visual identity would add no signal while making
// the fixture look like something it is not.
//
// One function per layout family, because a family is what a template IS: the
// engine's grouping state machine was written against "title row, then figure
// rows", and every other arrangement here is a way that assumption fails.
import {
  accountNumberText,
  formatAmount,
  groupDigits,
  type ScreenSpec,
  type SpecAccount,
} from "./spec";

// Escapes text into HTML. Specs carry parentheses, ampersands and CJK; a bare
// interpolation of "Pay & transfer" produces an invalid entity and Chrome
// silently drops the rest of the run.
function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const LATIN_FONTS = `-apple-system,"SF Pro Text",Helvetica,Arial,sans-serif`;
const CJK_FONTS = `-apple-system,"PingFang SC","Hiragino Sans GB","Heiti SC",sans-serif`;

// The phone the screens are rendered at. 390×844 is the iPhone 14/15/16 logical
// viewport; the capture runs at 3× so Vision reads real-density glyphs rather
// than the blurry ones a 1× render produces — the OCR quality of the fixture is
// the thing being recorded, so it has to be device-plausible.
export const VIEWPORT = { width: 390, height: 844, scale: 3 } as const;

function styles(spec: ScreenSpec): string {
  const fonts = spec.script === "cjk" ? CJK_FONTS : LATIN_FONTS;
  return `
*{margin:0;padding:0;box-sizing:border-box}
body{width:${VIEWPORT.width}px;height:${VIEWPORT.height}px;background:#f2f3f5;color:#111418;
  font-family:${fonts};-webkit-font-smoothing:antialiased;overflow:hidden}
.status{height:54px;display:flex;align-items:flex-end;justify-content:space-between;
  padding:0 26px 6px;font-size:15px;font-weight:600}
.hdr{padding:10px 20px 2px}
.hdr h1{font-size:25px;font-weight:700;letter-spacing:-.4px}
.hdr p{font-size:13px;color:#6b7280;margin-top:3px}
.sec{font-size:12px;font-weight:700;letter-spacing:.9px;color:#6b7280;padding:18px 20px 7px}
.card{background:#fff;border-radius:14px;margin:0 16px 9px;padding:14px 17px;
  box-shadow:0 1px 2px rgba(0,0,0,.05)}
.row{display:flex;justify-content:space-between;align-items:baseline;gap:10px}
.nm{font-size:16px;font-weight:600}
.num{font-size:13px;color:#6b7280;font-weight:400}
.amt{font-size:19px;font-weight:700;letter-spacing:-.2px;white-space:nowrap}
.neg{color:#b3261e}
.cap{font-size:13px;color:#6b7280;margin-top:4px}
.det{font-size:13px;color:#6b7280;margin-top:8px;display:flex;justify-content:space-between}
.sum{margin:6px 16px 4px;padding:16px 18px;background:#fff;border-radius:14px}
.sum .l{font-size:13px;color:#6b7280}
.sum .v{font-size:29px;font-weight:700;letter-spacing:-.6px;margin-top:4px}
.tabs{position:absolute;bottom:0;width:${VIEWPORT.width}px;height:74px;background:#fff;
  border-top:1px solid #e5e7eb;display:flex;font-size:11px;color:#6b7280}
.tabs div{flex:1;text-align:center;padding-top:13px}
table{width:100%;border-collapse:collapse}
th,td{font-size:14px;padding:7px 0;text-align:right}
th:first-child,td:first-child{text-align:left}
th{font-size:12px;color:#6b7280;font-weight:600}
`;
}

function statusBar(spec: ScreenSpec): string {
  return `<div class="status"><span>${esc(spec.clock ?? "9:41")}</span><span>5G</span></div>`;
}

function header(spec: ScreenSpec): string {
  if (!spec.header) {
    return "";
  }
  const subtitle = spec.header.subtitle
    ? `<p>${esc(spec.header.subtitle)}</p>`
    : "";
  return `<div class="hdr"><h1>${esc(spec.header.title)}</h1>${subtitle}</div>`;
}

// The screen-level total. Rendered as its own block above the accounts, which
// is where every overview puts it — and the row the engine must classify as a
// summary rather than opening an account for.
function summary(spec: ScreenSpec): string {
  if (!spec.summary) {
    return "";
  }
  const value = formatAmount(spec, {
    currency: spec.summary.currency,
    balance: spec.summary.value,
  });
  return `<div class="sum"><div class="l">${esc(spec.summary.label)}</div><div class="v">${esc(value)}</div></div>`;
}

function tabs(spec: ScreenSpec): string {
  if (!spec.tabs) {
    return "";
  }
  return `<div class="tabs">${spec.tabs.map((tab) => `<div>${esc(tab)}</div>`).join("")}</div>`;
}

function amountSpan(spec: ScreenSpec, account: SpecAccount): string {
  return account.balances
    .map((balance) => {
      const negative = balance.balance < 0;
      return `<span class="amt${negative ? " neg" : ""}">${esc(formatAmount(spec, balance))}</span>`;
    })
    .join(" ");
}

function captionAndDetails(account: SpecAccount): string {
  const caption = account.caption
    ? `<div class="cap">${esc(account.caption)}</div>`
    : "";
  return caption + detailRows(account);
}

// The label/value shelf beneath an account — an available credit, a buying
// power, a day P/L. Split out of `captionAndDetails` because `brokerPortfolio`
// needs the shelf without the caption: there the caption sits INSIDE the amount
// row, and a second copy of the row markup is how the two would drift.
function detailRows(account: SpecAccount): string {
  return (account.details ?? [])
    .map(
      (detail) =>
        `<div class="det"><span>${esc(detail.label)}</span><span>${esc(detail.value)}</span></div>`,
    )
    .join("");
}

function nameWithNumber(account: SpecAccount): string {
  const number = accountNumberText(account);
  return (
    `<span class="nm">${esc(account.name)}` +
    (number ? ` <span class="num">${esc(number)}</span>` : "") +
    `</span>`
  );
}

// ── Layout families ────────────────────────────────────────────────────────

// Every section-based family draws the same frame — an optional section
// heading, then that section's accounts — and differs only in how ONE account
// is drawn. The frame lives here once so a change to it (a class, a wrapper, a
// heading) reaches every family instead of four of the five.
function sections(
  spec: ScreenSpec,
  renderAccount: (spec: ScreenSpec, account: SpecAccount) => string,
): string {
  return spec.sections
    .map((section) => {
      const title = section.title
        ? `<div class="sec">${esc(section.title)}</div>`
        : "";
      return (
        title +
        section.accounts.map((account) => renderAccount(spec, account)).join("")
      );
    })
    .join("");
}

// Name and figure on ONE line. The card `sectioned-list` is made of, and the
// one `neobank-wallet` uses for the currencies beside its headline balance.
function oneLineCard(spec: ScreenSpec, account: SpecAccount): string {
  return `<div class="card"><div class="row">${nameWithNumber(account)}${amountSpan(spec, account)}</div>${captionAndDetails(account)}</div>`;
}

// Name and figure on ONE line, under a section header. The dominant US and UK
// retail layout, and the one the engine's "title row, then figure rows" state
// machine has no case for: every such row classifies as an amount row, so it
// never opens an account and its figure is banked against whatever opened last.
function sectionedList(spec: ScreenSpec): string {
  return sections(spec, oneLineCard);
}

// Name on its own line, figure beneath — what the real corpus is mostly made of,
// included so the synthetic corpus can show a layout the engine DOES handle and
// the numbers mean something relative to it.
function stackedCard(spec: ScreenSpec, account: SpecAccount): string {
  const number = accountNumberText(account);
  return (
    `<div class="card">` +
    `<div class="nm">${esc(account.name)}</div>` +
    (number ? `<div class="num">${esc(number)}</div>` : "") +
    `<div class="row" style="margin-top:6px">${amountSpan(spec, account)}</div>` +
    captionAndDetails(account) +
    `</div>`
  );
}

function stackedCards(spec: ScreenSpec): string {
  return sections(spec, stackedCard);
}

// A currency header row over a figures row. Column alignment is the only thing
// that says which figure belongs to which currency, so this is the family that
// tests geometry rather than vocabulary.
function currencyCard(spec: ScreenSpec, account: SpecAccount): string {
  const number = accountNumberText(account);
  const head = account.balances
    .map((balance) => `<th>${esc(balance.printedAs ?? balance.currency)}</th>`)
    .join("");
  const body = account.balances
    .map((balance) => `<td>${esc(groupDigits(balance.balance))}</td>`)
    .join("");
  return (
    `<div class="card">` +
    `<div class="nm">${esc(account.name)}</div>` +
    (number ? `<div class="num">${esc(number)}</div>` : "") +
    `<table><tr><th></th>${head}</tr><tr><td>${esc(account.caption ?? "")}</td>${body}</tr></table>` +
    `</div>`
  );
}

function currencyTable(spec: ScreenSpec): string {
  return sections(spec, currencyCard);
}

// A broker's portfolio head: one big net figure and a shelf of metrics that are
// NOT balances (margin requirement, buying power, day P/L). The metrics are the
// point — every one of them is a well-formed money figure sitting beside the
// account, and a parser that banks them reports money the user does not have.
function brokerCard(spec: ScreenSpec, account: SpecAccount): string {
  const number = accountNumberText(account);
  return (
    `<div class="card">` +
    `<div class="nm">${esc(account.name)}</div>` +
    (number ? `<div class="num">${esc(number)}</div>` : "") +
    `<div class="row" style="margin-top:8px"><span class="cap">${esc(account.caption ?? "")}</span>${amountSpan(spec, account)}</div>` +
    detailRows(account) +
    `</div>`
  );
}

function brokerPortfolio(spec: ScreenSpec): string {
  return sections(spec, brokerCard);
}
// One account's own page. The balance is the only figure that is a balance; the
// transaction list beneath it is a column of well-formed amounts that must not
// become balances, and a dated one beside each.
function accountDetail(spec: ScreenSpec): string {
  const account = spec.sections[0]?.accounts[0];
  if (!account) {
    return "";
  }
  const rows = (spec.notes ?? [])
    .map((note) => {
      const [label, value] = note.split("|");
      return `<div class="det" style="margin-top:14px"><span style="color:#111418;font-size:14px">${esc(label)}</span><span style="color:#111418;font-size:14px">${esc(value ?? "")}</span></div>`;
    })
    .join("");
  return (
    `<div class="sum"><div class="l">${esc(account.caption ?? "")}</div>` +
    `<div class="v">${esc(formatAmount(spec, account.balances[0]))}</div>` +
    `<div class="num" style="margin-top:6px">${esc(account.name)} ${esc(accountNumberText(account) ?? "")}</div></div>` +
    `<div class="sec">${esc(spec.sections[0]?.title ?? "")}</div>` +
    `<div class="card">${rows}</div>`
  );
}

// A neobank's wallet: one big balance, then the other currencies as chips. The
// big figure has no label row of its own, which is what makes the account's
// name the app's own brand — the one case where the institution IS the account.
function neobankWallet(spec: ScreenSpec): string {
  const [first, ...rest] = spec.sections[0]?.accounts ?? [];
  if (!first) {
    return "";
  }
  const chips = rest.map((account) => oneLineCard(spec, account)).join("");
  return (
    `<div class="sum"><div class="l">${esc(first.caption ?? "")}</div>` +
    `<div class="v">${esc(formatAmount(spec, first.balances[0]))}</div>` +
    `<div class="num" style="margin-top:6px">${esc(first.name)}</div></div>` +
    `<div class="sec">${esc(spec.sections[0]?.title ?? "")}</div>` +
    chips
  );
}

const LAYOUTS: Record<ScreenSpec["layout"], (spec: ScreenSpec) => string> = {
  "sectioned-list": sectionedList,
  "stacked-cards": stackedCards,
  "currency-table": currencyTable,
  "broker-portfolio": brokerPortfolio,
  // An exchange's asset list is the one-line card too: the token's quantity —
  // a bare number in a unit that is not a currency — rides in the caption, so
  // the markup is `sectioned-list`'s exactly. Kept as its own layout id because
  // the corpus names it as a family, but it renders identically today, and a
  // template that gave it the column it describes (quantity above the converted
  // value) would be the thing that makes the id mean something.
  "exchange-assets": sectionedList,
  "account-detail": accountDetail,
  "neobank-wallet": neobankWallet,
};

/** The full HTML document one synthetic screenshot is taken of. */
export function renderScreen(spec: ScreenSpec): string {
  const brand =
    spec.institution.printed === false
      ? ""
      : `<div class="sec" style="padding-top:8px;letter-spacing:0;font-size:15px;color:#111418">${esc(spec.institution.name)}</div>`;
  return [
    "<!doctype html>",
    `<html lang="${spec.script === "cjk" ? "zh" : "en"}"><head><meta charset="utf-8">`,
    `<style>${styles(spec)}</style></head><body>`,
    statusBar(spec),
    brand,
    header(spec),
    summary(spec),
    LAYOUTS[spec.layout](spec),
    tabs(spec),
    "</body></html>",
  ].join("");
}
