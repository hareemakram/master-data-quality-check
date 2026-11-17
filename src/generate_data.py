"""Generate realistic sample master data (customers, vendors, materials) with
known, deliberately injected data-quality defects, plus all reference/config
tables. Writes data/*.json and data/expected_exceptions.json (ground truth
used by the test-suite).

Deterministic: seeded RNG, so every run produces identical data.
"""
import json, random, string, datetime, os, re

random.seed(20251117)
OUT = os.path.join(os.path.dirname(__file__), "..", "data")
os.makedirs(OUT, exist_ok=True)

# --------------------------------------------------------------------------
# Reference data
# --------------------------------------------------------------------------
# Pattern masks: '#' = digit, '@' = letter, '?' = letter or digit, anything
# else is a literal. Several alternative masks are separated by '|'.
COUNTRIES = [
    # ISO2, Name, Region, Currency, PhoneCode, PostalPattern, TaxPattern, IBANLength
    ("US", "United States", "NA", "USD", "1", "#####|#####-####", "##-#######", None),
    ("CA", "Canada", "NA", "CAD", "1", "@#@ #@#", "#########", None),
    ("MX", "Mexico", "LATAM", "MXN", "52", "#####", "@@@######???", None),
    ("BR", "Brazil", "LATAM", "BRL", "55", "#####-###", "##.###.###/####-##", None),
    ("GB", "United Kingdom", "EMEA", "GBP", "44", "@# #@@|@## #@@|@@# #@@|@@## #@@|@#@ #@@|@@#@ #@@", "GB#########", 22),
    ("DE", "Germany", "EMEA", "EUR", "49", "#####", "DE#########", 22),
    ("FR", "France", "EMEA", "EUR", "33", "#####", "FR??#########", 27),
    ("NL", "Netherlands", "EMEA", "EUR", "31", "#### @@", "NL#########B##", 18),
    ("ES", "Spain", "EMEA", "EUR", "34", "#####", "ES?#######?", 24),
    ("IT", "Italy", "EMEA", "EUR", "39", "#####", "IT###########", 27),
    ("AE", "United Arab Emirates", "EMEA", "AED", "971", "", "###############", 23),
    ("IN", "India", "APAC", "INR", "91", "######", "##@@@@@####@?Z?", None),
    ("SG", "Singapore", "APAC", "SGD", "65", "######", "#########@", None),
    ("AU", "Australia", "APAC", "AUD", "61", "####", "## ### ### ###", None),
    ("JP", "Japan", "APAC", "JPY", "81", "###-####", "#############", None),
]
CITIES = {
    "US": ["New York", "Chicago", "Austin", "Seattle", "Atlanta", "Denver", "Boston"],
    "CA": ["Toronto", "Vancouver", "Montreal", "Calgary"],
    "MX": ["Mexico City", "Monterrey", "Guadalajara"],
    "BR": ["Sao Paulo", "Rio de Janeiro", "Curitiba"],
    "GB": ["London", "Manchester", "Leeds", "Bristol"],
    "DE": ["Berlin", "Munich", "Hamburg", "Frankfurt"],
    "FR": ["Paris", "Lyon", "Toulouse"],
    "NL": ["Amsterdam", "Rotterdam", "Utrecht"],
    "ES": ["Madrid", "Barcelona", "Valencia"],
    "IT": ["Milan", "Rome", "Turin"],
    "AE": ["Dubai", "Abu Dhabi"],
    "IN": ["Mumbai", "Bengaluru", "Pune", "Delhi"],
    "SG": ["Singapore"],
    "AU": ["Sydney", "Melbourne", "Brisbane"],
    "JP": ["Tokyo", "Osaka", "Nagoya"],
}
LEGAL = {"US": "Inc", "CA": "Ltd", "MX": "SA de CV", "BR": "Ltda", "GB": "Ltd", "DE": "GmbH",
         "FR": "SARL", "NL": "BV", "ES": "SL", "IT": "SpA", "AE": "LLC", "IN": "Pvt Ltd",
         "SG": "Pte Ltd", "AU": "Pty Ltd", "JP": "KK"}
CURRENCIES = sorted({c[3] for c in COUNTRIES} | {"CHF", "SEK", "CNY"})
PAYMENT_TERMS = ["NT15", "NT30", "NT45", "NT60", "NT90", "2/10NT30", "COD"]
UOMS = ["EA", "KG", "G", "L", "ML", "M", "CM", "BOX", "PAL", "SET", "ROL", "HR"]
MATERIAL_TYPES = [("FERT", "Finished product"), ("HALB", "Semi-finished product"),
                  ("ROH", "Raw material"), ("HAWA", "Trading goods"), ("DIEN", "Service")]
PURCHASED_TYPES = ["ROH", "HAWA"]
STATUSES = ["Active", "Blocked", "Inactive"]
PLANTS = ["1000", "1100", "2000", "3000", "4000"]

LISTS = ([("Currency", c) for c in CURRENCIES] + [("PaymentTerms", p) for p in PAYMENT_TERMS] +
         [("UoM", u) for u in UOMS] + [("MaterialType", m[0]) for m in MATERIAL_TYPES] +
         [("Status", s) for s in STATUSES] + [("Plant", p) for p in PLANTS] +
         [("PurchasedMaterialType", t) for t in PURCHASED_TYPES])

RULES = [
    # RuleID, Category, RuleName, Applies to, Severity, Threshold, Description
    ("DUP-001", "Duplicate", "Duplicate record ID", "Customer, Vendor, Material", "Critical", None,
     "The same primary key appears on more than one row. Every occurrence after the first is flagged."),
    ("DUP-002", "Duplicate", "Exact duplicate record", "Customer, Vendor, Material", "High", None,
     "Same normalised name and country (partners) or same normalised description, type and UoM (materials)."),
    ("DUP-003", "Duplicate", "Duplicate tax ID", "Customer, Vendor", "High", None,
     "Two records share the same tax / VAT registration number."),
    ("DUP-004", "Duplicate", "Duplicate email address", "Customer, Vendor", "Medium", None,
     "Two records share the same email address."),
    ("DUP-005", "Duplicate", "Potential (fuzzy) duplicate", "Customer, Vendor, Material", "Medium", 0.85,
     "Name/description similarity (Dice coefficient on character bigrams) at or above the threshold within the same country or material type."),
    ("DUP-006", "Duplicate", "Duplicate bank account (IBAN)", "Vendor", "Critical", None,
     "Two vendors are paid into the same bank account - a common payment-fraud indicator."),
    ("MIS-001", "Missing", "Required field missing", "Customer, Vendor, Material", "High", None,
     "A field listed in the Required Fields table is blank."),
    ("MIS-002", "Missing", "Purchased material has no vendor", "Material", "High", None,
     "Materials whose type is in the PurchasedMaterialType list (ROH, HAWA by default) must have a preferred vendor."),
    ("INC-001", "Inconsistent", "Invalid email format", "Customer, Vendor", "Medium", None,
     "Email must have one @, a non-empty local part, a dotted domain, a 2+ letter TLD and no spaces."),
    ("INC-002", "Inconsistent", "Invalid phone number", "Customer, Vendor", "Low", None,
     "Phone must be +<country calling code> followed by digits, 8-15 digits in total."),
    ("INC-003", "Inconsistent", "Invalid country code", "Customer, Vendor", "High", None,
     "Country must be an upper-case ISO 3166 alpha-2 code from the Countries table."),
    ("INC-004", "Inconsistent", "Tax ID format invalid for country", "Customer, Vendor", "High", None,
     "Tax ID does not match the country's tax ID pattern."),
    ("INC-005", "Inconsistent", "Postal code format invalid", "Customer, Vendor", "Medium", None,
     "Postal code does not match the country's postal code pattern."),
    ("INC-006", "Inconsistent", "Invalid currency code", "Customer, Vendor, Material", "Medium", None,
     "Currency is not in the approved currency list."),
    ("INC-007", "Inconsistent", "Invalid payment terms", "Customer, Vendor", "Medium", None,
     "Payment terms are not in the approved payment terms list."),
    ("INC-008", "Inconsistent", "Name formatting issue", "Customer, Vendor, Material", "Low", None,
     "Leading/trailing spaces, repeated spaces or an all lower-case name."),
    ("INC-009", "Inconsistent", "Invalid or future created date", "Customer, Vendor, Material", "Medium", None,
     "Created date is not a valid date or is later than the run date."),
    ("INC-010", "Inconsistent", "Invalid status value", "Customer, Vendor, Material", "Low", None,
     "Status is not one of the approved status values."),
    ("INC-011", "Inconsistent", "Invalid unit of measure", "Material", "High", None,
     "Base unit of measure is not in the approved UoM list."),
    ("INC-012", "Inconsistent", "Invalid material type", "Material", "Medium", None,
     "Material type is not in the approved material type list."),
    ("INC-013", "Inconsistent", "Vendor not found in vendor master", "Material", "High", None,
     "Preferred vendor ID does not exist in the vendor master (broken reference)."),
    ("INC-014", "Inconsistent", "Preferred vendor is blocked", "Material", "Medium", None,
     "Preferred vendor exists but its status is Blocked."),
    ("INC-015", "Inconsistent", "Invalid numeric value", "Customer, Material", "High", None,
     "Credit limit must be a number >= 0; standard price a number > 0; gross weight a number >= 0."),
    ("INC-016", "Inconsistent", "Invalid IBAN", "Vendor", "High", None,
     "IBAN fails the length check for its country or the ISO 13616 mod-97 checksum."),
    ("INC-017", "Inconsistent", "Invalid plant", "Material", "Low", None,
     "Plant is not in the approved plant list."),
]
REQUIRED = [
    ("Customer", "CustomerID", "Critical"), ("Customer", "CustomerName", "High"),
    ("Customer", "Country", "High"), ("Customer", "City", "Medium"), ("Customer", "Email", "Medium"),
    ("Customer", "TaxID", "High"), ("Customer", "Currency", "High"), ("Customer", "PaymentTerms", "Medium"),
    ("Customer", "Status", "Medium"),
    ("Vendor", "VendorID", "Critical"), ("Vendor", "VendorName", "High"), ("Vendor", "Country", "High"),
    ("Vendor", "City", "Medium"), ("Vendor", "Email", "Medium"), ("Vendor", "TaxID", "High"),
    ("Vendor", "Currency", "High"), ("Vendor", "PaymentTerms", "High"), ("Vendor", "Status", "Medium"),
    ("Material", "MaterialID", "Critical"), ("Material", "Description", "High"),
    ("Material", "MaterialType", "High"), ("Material", "BaseUoM", "High"), ("Material", "MaterialGroup", "Medium"),
    ("Material", "Plant", "High"), ("Material", "StandardPrice", "High"), ("Material", "Currency", "High"),
    ("Material", "Status", "Medium"),
]
OWNERS = [
    ("Customer", "NA", "Olivia Bennett", "olivia.bennett@contoso.com"),
    ("Customer", "LATAM", "Mateo Alvarez", "mateo.alvarez@contoso.com"),
    ("Customer", "EMEA", "Sophie Laurent", "sophie.laurent@contoso.com"),
    ("Customer", "APAC", "Arjun Mehta", "arjun.mehta@contoso.com"),
    ("Vendor", "NA", "Daniel Brooks", "daniel.brooks@contoso.com"),
    ("Vendor", "LATAM", "Camila Rocha", "camila.rocha@contoso.com"),
    ("Vendor", "EMEA", "Lukas Fischer", "lukas.fischer@contoso.com"),
    ("Vendor", "APAC", "Mei Tanaka", "mei.tanaka@contoso.com"),
    ("Material", "*", "Priya Nair", "priya.nair@contoso.com"),
    ("*", "*", "Grace Okafor (Data Governance)", "data.governance@contoso.com"),
]
SETTINGS = [
    ("RunDateOverride", "", "Leave blank to use today's date. Set yyyy-mm-dd to reproduce a historical run."),
    ("GovernanceEmail", "data.governance@contoso.com", "Receives the weekly summary and any flow failure alerts."),
    ("ReportLibrary", "Shared Documents/Data Quality/Exception Reports", "SharePoint folder for weekly exception reports."),
]

C = {c[0]: c for c in COUNTRIES}
RUN_DATE = datetime.date(2026, 11, 17)

# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
LEGAL_TOKENS = {"inc", "incorporated", "ltd", "limited", "llc", "gmbh", "ag", "sa", "sarl", "bv", "nv", "plc",
                "co", "corp", "corporation", "company", "pty", "pte", "pvt", "srl", "spa", "sl", "kk", "ltda",
                "de", "cv", "the"}


def norm_name(s):
    s = s.lower().replace("&", " and ")
    s = "".join(ch if ch.isalnum() else " " for ch in s)
    return " ".join(t for t in s.split() if t not in LEGAL_TOKENS)


def dice(a, b):
    a, b = a.replace(" ", ""), b.replace(" ", "")
    if len(a) < 2 or len(b) < 2:
        return 1.0 if a == b else 0.0
    ba = [a[i:i + 2] for i in range(len(a) - 1)]
    bb = [b[i:i + 2] for i in range(len(b) - 1)]
    pool = list(bb); inter = 0
    for g in ba:
        if g in pool:
            pool.remove(g); inter += 1
    return 2 * inter / (len(ba) + len(bb))


def fill(mask):
    out = []
    for ch in mask:
        if ch == "#": out.append(random.choice(string.digits))
        elif ch == "@": out.append(random.choice(string.ascii_uppercase))
        elif ch == "?": out.append(random.choice(string.ascii_uppercase + string.digits))
        else: out.append(ch)
    return "".join(out)


def postal(cc):
    p = C[cc][5]
    return fill(random.choice(p.split("|"))) if p else ""


def tax(cc):
    return fill(C[cc][6])


def phone(cc):
    code = C[cc][4]
    n = 10 - len(code) + 1
    return "+" + code + " " + "".join(random.choice(string.digits) for _ in range(max(n, 8)))


def iban(cc):
    ln = C[cc][7]
    bban_len = ln - 4
    if cc in ("GB", "NL"):
        bban = "".join(random.choice(string.ascii_uppercase) for _ in range(4)) + \
               "".join(random.choice(string.digits) for _ in range(bban_len - 4))
    elif cc == "IT":
        bban = random.choice(string.ascii_uppercase) + "".join(random.choice(string.digits) for _ in range(bban_len - 1))
    else:
        bban = "".join(random.choice(string.digits) for _ in range(bban_len))
    num = "".join(str(int(ch, 36)) for ch in bban + cc + "00")
    check = 98 - int(num) % 97
    return f"{cc}{check:02d}{bban}"


def rand_date(start=datetime.date(2015, 1, 1), end=datetime.date(2026, 10, 31)):
    return start + datetime.timedelta(days=random.randint(0, (end - start).days))


WORDS_A = ["Northwind", "Contoso", "Fabrikam", "Tailspin", "Wingtip", "Adventure", "Litware", "Proseware",
           "Lucerne", "Margie", "Blue Yonder", "Coho", "Alpine", "Fourth", "Humongous", "Wide World", "Trey",
           "Southridge", "Graphic", "Woodgrove", "Datum", "Relecloud", "Tasmanian", "Bellows", "Consolidated",
           "Lamna", "Nod", "Olympia", "Pinnacle", "Quantum", "Redwood", "Summit", "Silverline", "Ironclad",
           "Evergreen", "Harbor", "Keystone", "Meridian", "Nimbus", "Orchid", "Polaris", "Sterling", "Vertex",
           "Zephyr", "Aurora", "Beacon", "Cobalt", "Driftwood", "Ember", "Falcon", "Granite", "Horizon",
           "Juniper", "Kestrel", "Lumen", "Mosaic", "Nova", "Onyx", "Prairie", "Quarry", "Riverbend",
           "Sapphire", "Tundra", "Umbra", "Vista", "Willow", "Yarrow", "Zenith", "Anchor", "Bramble",
           "Cascade", "Dune", "Everest", "Fjord", "Glacier", "Halcyon", "Indigo", "Jasper", "Kingfisher"]
WORDS_B = ["Traders", "Logistics", "Foods", "Electronics", "Pharma", "Textiles", "Motors", "Systems",
           "Industries", "Retail", "Packaging", "Chemicals", "Analytics", "Energy", "Outfitters", "Brewing",
           "Labs", "Metals", "Furniture", "Healthcare", "Robotics", "Plastics", "Optics", "Marine", "Builders"]


class NamePool:
    def __init__(self):
        self.used = []

    def make(self, cc, legal=True):
        for _ in range(5000):
            n = f"{random.choice(WORDS_A)} {random.choice(WORDS_B)}"
            nn = norm_name(n)
            if all(dice(nn, u) < 0.72 for u in self.used):
                self.used.append(nn)
                return f"{n} {LEGAL[cc]}" if legal else n
        raise RuntimeError("name pool exhausted")


def email_for(name, i):
    dom = norm_name(name).replace(" ", "") or "example"
    return f"{random.choice(['ap', 'billing', 'orders', 'finance', 'accounts', 'sales'])}{i}@{dom[:18]}.com"


expected = []  # (entity, row, rule, field)


def exp(entity, row, rule, field):
    expected.append({"Entity": entity, "Row": row, "RuleID": rule, "Field": field})


# --------------------------------------------------------------------------
# Partner (customer / vendor) generation
# --------------------------------------------------------------------------
def gen_partner(kind, prefix, start_id, n_clean, pool):
    ent = kind
    idf, namef = f"{kind}ID", f"{kind}Name"
    rows = []
    weights = {"US": 6, "CA": 2, "MX": 2, "BR": 2, "GB": 4, "DE": 4, "FR": 3, "NL": 2, "ES": 2, "IT": 2,
               "AE": 1, "IN": 3, "SG": 1, "AU": 2, "JP": 2}
    ccs = [c for c, w in weights.items() for _ in range(w)]
    nid = start_id

    def new_rec(cc=None):
        nonlocal nid
        cc = cc or random.choice(ccs)
        name = pool.make(cc)
        r = {idf: f"{prefix}{nid}", namef: name, "Country": cc, "City": random.choice(CITIES[cc]),
             "PostalCode": postal(cc), "Email": email_for(name, nid % 97), "Phone": phone(cc),
             "TaxID": tax(cc), "Currency": C[cc][3],
             "PaymentTerms": random.choice(PAYMENT_TERMS)}
        if kind == "Customer":
            r["CreditLimit"] = random.choice([5000, 10000, 25000, 50000, 75000, 100000, 250000])
        else:
            r["BankIBAN"] = iban(cc) if C[cc][7] else ""
        r["CreatedDate"] = rand_date().isoformat()
        r["Status"] = random.choices(STATUSES, [85, 8, 7])[0]
        nid += 1
        return r

    for _ in range(n_clean):
        rows.append(new_rec())

    def add(r):
        rows.append(r)
        return len(rows)  # 1-based row number

    def defect(mut, rules, cc=None):
        r = new_rec(cc)
        mut(r)
        row = add(r)
        for rule, field in rules:
            exp(ent, row, rule, field)
        return row

    # --- Missing ---------------------------------------------------------
    defect(lambda r: r.update({namef: ""}), [("MIS-001", namef)])
    defect(lambda r: r.update({namef: None}), [("MIS-001", namef)])
    defect(lambda r: r.update({"Email": ""}), [("MIS-001", "Email")])
    defect(lambda r: r.update({"Email": None, "Phone": ""}), [("MIS-001", "Email")])
    defect(lambda r: r.update({"TaxID": "  "}), [("MIS-001", "TaxID")])
    defect(lambda r: r.update({"Country": "", "PostalCode": "", "Phone": ""}), [("MIS-001", "Country")])
    defect(lambda r: r.update({"City": "", "PaymentTerms": None}), [("MIS-001", "City"), ("MIS-001", "PaymentTerms")])
    defect(lambda r: r.update({"Currency": ""}), [("MIS-001", "Currency")])
    defect(lambda r: r.update({"Status": ""}), [("MIS-001", "Status")])
    # --- Inconsistent ----------------------------------------------------
    for bad in ["john.doe@", "accounts.contoso.com", "billing team@fabrikam.com", "ap@fabrikam", "orders@@litware.com"]:
        defect(lambda r, b=bad: r.update({"Email": b}), [("INC-001", "Email")])
    defect(lambda r: r.update({"Phone": "+33 612345678"}), [("INC-002", "Phone")], cc="DE")
    defect(lambda r: r.update({"Phone": "555-0199"}), [("INC-002", "Phone")], cc="US")
    defect(lambda r: r.update({"Phone": "+44 20 7946 ABCD"}), [("INC-002", "Phone")], cc="GB")
    for bad in ["XX", "usa", "uk"]:
        defect(lambda r, b=bad: r.update({"Country": b}), [("INC-003", "Country")])
    defect(lambda r: r.update({"TaxID": "123456789"}), [("INC-004", "TaxID")], cc="US")
    defect(lambda r: r.update({"TaxID": "DE12345"}), [("INC-004", "TaxID")], cc="DE")
    defect(lambda r: r.update({"TaxID": "GB12345678X"}), [("INC-004", "TaxID")], cc="GB")
    defect(lambda r: r.update({"PostalCode": "1234"}), [("INC-005", "PostalCode")], cc="US")
    defect(lambda r: r.update({"PostalCode": "SW1A1AA"}), [("INC-005", "PostalCode")], cc="GB")
    defect(lambda r: r.update({"PostalCode": "ABCDE"}), [("INC-005", "PostalCode")], cc="FR")
    defect(lambda r: r.update({"Currency": "US$"}), [("INC-006", "Currency")])
    defect(lambda r: r.update({"Currency": "EURO"}), [("INC-006", "Currency")])
    defect(lambda r: r.update({"PaymentTerms": "Net 30"}), [("INC-007", "PaymentTerms")])
    defect(lambda r: r.update({"PaymentTerms": "30 days"}), [("INC-007", "PaymentTerms")])
    defect(lambda r: r.update({namef: "  " + r[namef]}), [("INC-008", namef)])
    defect(lambda r: r.update({namef: r[namef].replace(" ", "  ", 1)}), [("INC-008", namef)])
    defect(lambda r: r.update({namef: r[namef].lower()}), [("INC-008", namef)])
    defect(lambda r: r.update({"CreatedDate": "2027-03-15"}), [("INC-009", "CreatedDate")])
    defect(lambda r: r.update({"CreatedDate": "31/02/2024"}), [("INC-009", "CreatedDate")])
    defect(lambda r: r.update({"Status": "Actve"}), [("INC-010", "Status")])
    if kind == "Customer":
        defect(lambda r: r.update({"CreditLimit": -5000}), [("INC-015", "CreditLimit")])
        defect(lambda r: r.update({"CreditLimit": "ten thousand"}), [("INC-015", "CreditLimit")])
    else:
        def bad_check(r):
            s = r["BankIBAN"]; r["BankIBAN"] = s[:-1] + str((int(s[-1]) + 1) % 10)
        defect(bad_check, [("INC-016", "BankIBAN")], cc="DE")
        defect(lambda r: r.update({"BankIBAN": r["BankIBAN"][:-2]}), [("INC-016", "BankIBAN")], cc="FR")
        defect(lambda r: r.update({"BankIBAN": "ZZ001234567890"}), [("INC-016", "BankIBAN")], cc="NL")
    # multi-defect records
    defect(lambda r: r.update({"Email": "sales.at.domain.com", "TaxID": "", "PostalCode": "99"}),
           [("INC-001", "Email"), ("MIS-001", "TaxID"), ("INC-005", "PostalCode")], cc="DE")
    defect(lambda r: r.update({"Phone": "12345", "Currency": "XYZ", namef: r[namef] + " "}),
           [("INC-002", "Phone"), ("INC-006", "Currency"), ("INC-008", namef)], cc="IN")

    # --- Duplicates ------------------------------------------------------
    clean_idx = list(range(n_clean))
    random.shuffle(clean_idx)
    pick = iter(clean_idx)
    # exact duplicate copy, new ID (DUP-002, DUP-003, DUP-004 [+ DUP-006 vendor w/ IBAN])
    for _ in range(3):
        src = rows[next(pick)]
        if kind == "Vendor":  # make sure the source has an IBAN so DUP-006 fires deterministically
            while not src.get("BankIBAN"):
                src = rows[next(pick)]
        r = dict(src); r[idf] = f"{prefix}{nid}"; nid += 1
        row = add(r)
        for rule, f in [("DUP-002", namef), ("DUP-003", "TaxID"), ("DUP-004", "Email")]:
            exp(ent, row, rule, f)
        if kind == "Vendor":
            exp(ent, row, "DUP-006", "BankIBAN")
    # duplicate primary key on a different record (DUP-001)
    for _ in range(2):
        src = rows[next(pick)]
        r = new_rec(); r[idf] = src[idf]
        row = add(r); exp(ent, row, "DUP-001", idf)
    # legal-suffix variant -> exact duplicate after normalisation (DUP-002 only)
    for _ in range(2):
        src = rows[next(pick)]; cc = src["Country"]
        r = new_rec(cc); pool.used.pop()
        base = src[namef].rsplit(" " + LEGAL[cc], 1)[0]
        r[namef] = base + {"Inc": " Incorporated", "Ltd": " Limited", "GmbH": " AG"}.get(LEGAL[cc], " Co.")
        r[namef] = r[namef].replace("  ", " ")
        row = add(r); exp(ent, row, "DUP-002", namef)
    # fuzzy duplicates (typos / plural) -> DUP-005
    def typo(name):
        words = name.split(" ")
        w = words[0]
        i = random.randint(1, len(w) - 2)
        words[0] = w[:i] + w[i] + w[i:]  # doubled keystroke typo
        return " ".join(words)
    for variant in ["typo", "plural", "typo", "amp"]:
        while True:
            src = rows[next(pick)]
            if src["Country"] in C and src[namef]:
                break
        cc = src["Country"]
        r = new_rec(cc); pool.used.pop()
        if variant == "typo":
            r[namef] = typo(src[namef])
        elif variant == "plural":
            r[namef] = src[namef].replace("s ", " ", 1) if "s " in src[namef] else src[namef].replace(" ", "s ", 1)
        else:
            r[namef] = src[namef].replace(" ", ", ", 1) + "."  # punctuation-only variant
        assert norm_name(r[namef]) != norm_name(src[namef]) or variant == "amp", r[namef]
        row = add(r)
        if norm_name(r[namef]) == norm_name(src[namef]):
            exp(ent, row, "DUP-002", namef)
        else:
            assert dice(norm_name(r[namef]), norm_name(src[namef])) >= 0.85, (r[namef], src[namef])
            exp(ent, row, "DUP-005", namef)
    # same tax ID, different company (DUP-003)
    src = rows[next(pick)]
    r = new_rec(src["Country"]); r["TaxID"] = src["TaxID"]
    row = add(r); exp(ent, row, "DUP-003", "TaxID")
    # shared email (DUP-004)
    src = rows[next(pick)]
    r = new_rec(); r["Email"] = src["Email"].upper()
    row = add(r); exp(ent, row, "DUP-004", "Email")
    if kind == "Vendor":
        for _ in range(2):  # same bank account, different vendor (DUP-006)
            src = rows[next(pick)]
            while not src.get("BankIBAN"):
                src = rows[next(pick)]
            r = new_rec("DE"); r["BankIBAN"] = src["BankIBAN"]
            row = add(r); exp(ent, row, "DUP-006", "BankIBAN")
    return rows


customers = gen_partner("Customer", "C", 10001, 150, NamePool())
vendors = gen_partner("Vendor", "V", 20001, 95, NamePool())

# --------------------------------------------------------------------------
# Materials
# --------------------------------------------------------------------------
MAT_NOUNS = {
    "FERT": ["Smart Thermostat", "Cordless Drill", "LED Floodlight", "Espresso Machine", "Office Chair",
             "Standing Desk", "Air Purifier", "Water Heater", "Solar Inverter", "Security Camera",
             "Robot Vacuum", "Bluetooth Speaker", "Gaming Monitor", "Electric Kettle", "Ceiling Fan",
             "Dishwasher", "Treadmill", "Pressure Washer", "Smart Doorbell", "Label Printer"],
    "HALB": ["Motor Assembly", "Circuit Board", "Gearbox Housing", "Wiring Harness", "Display Module",
             "Heating Element", "Pump Subassembly", "Sensor Array", "Battery Pack", "Control Panel",
             "Filter Cartridge", "Valve Block"],
    "ROH": ["Copper Wire", "Aluminium Sheet", "Polypropylene Granules", "Stainless Rod", "Silicone Sealant",
            "Epoxy Resin", "Glass Fibre", "Brass Fittings", "Rubber Gasket", "Lithium Cells",
            "Cardboard Carton", "Steel Coil", "Nylon Webbing", "Ceramic Tile", "Cotton Yarn"],
    "HAWA": ["Safety Gloves", "Ear Defenders", "Cable Ties", "Printer Toner", "Hand Sanitiser",
             "First Aid Kit", "Hi-Vis Vest", "Packing Tape", "Pallet Wrap", "Work Boots"],
    "DIEN": ["Installation Service", "Annual Maintenance", "Calibration Visit", "Freight Handling",
             "Engineering Consulting", "Repair Labour"],
}
MAT_ATTR = ["Premium", "Standard", "Compact", "Heavy Duty", "Industrial", "Eco", "Pro", "Mini", "Max", "Ultra"]
UOM_FOR = {"FERT": ["EA", "SET"], "HALB": ["EA", "SET"], "ROH": ["KG", "M", "L", "ROL", "EA"],
           "HAWA": ["EA", "BOX", "PAL", "ROL"], "DIEN": ["HR", "EA"]}
GROUPS = {"FERT": "FG-", "HALB": "SF-", "ROH": "RM-", "HAWA": "TG-", "DIEN": "SV-"}

active_vendors = [v["VendorID"] for v in vendors[:95] if v["Status"] == "Active"]
blocked_vendors = [v["VendorID"] for v in vendors[:95] if v["Status"] == "Blocked"]
assert len(blocked_vendors) >= 2, blocked_vendors

materials = []
used_desc = {t: [] for t in MAT_NOUNS}
mid = 30001


def new_mat(mtype=None):
    global mid
    mtype = mtype or random.choices(list(MAT_NOUNS), [30, 20, 25, 15, 10])[0]
    for _ in range(5000):
        d = f"{random.choice(MAT_ATTR)} {random.choice(MAT_NOUNS[mtype])}"
        nd = norm_name(d)
        if all(dice(nd, u) < 0.75 for u in used_desc[mtype]):
            used_desc[mtype].append(nd)
            break
    else:
        raise RuntimeError("material pool exhausted")
    r = {"MaterialID": f"M{mid}", "Description": d, "MaterialType": mtype,
         "BaseUoM": random.choice(UOM_FOR[mtype]), "MaterialGroup": GROUPS[mtype] + str(random.randint(100, 140)),
         "PreferredVendorID": random.choice(active_vendors) if mtype in PURCHASED_TYPES or random.random() < 0.3 else "",
         "Plant": random.choice(PLANTS), "StandardPrice": round(random.uniform(0.5, 2500), 2), "Currency": "USD",
         "GrossWeightKg": 0 if mtype == "DIEN" else round(random.uniform(0.05, 80), 3),
         "CreatedDate": rand_date().isoformat(), "Status": random.choices(STATUSES, [88, 6, 6])[0]}
    mid += 1
    return r


for _ in range(110):
    materials.append(new_mat())


def mdefect(mut, rules, mtype=None):
    r = new_mat(mtype); mut(r); materials.append(r)
    row = len(materials)
    for rule, f in rules:
        exp("Material", row, rule, f)


mdefect(lambda r: r.update({"Description": ""}), [("MIS-001", "Description")])
mdefect(lambda r: r.update({"MaterialGroup": None}), [("MIS-001", "MaterialGroup")])
mdefect(lambda r: r.update({"StandardPrice": None}), [("MIS-001", "StandardPrice")])
mdefect(lambda r: r.update({"Plant": ""}), [("MIS-001", "Plant")])
mdefect(lambda r: r.update({"BaseUoM": ""}), [("MIS-001", "BaseUoM")])
mdefect(lambda r: r.update({"PreferredVendorID": ""}), [("MIS-002", "PreferredVendorID")], "ROH")
mdefect(lambda r: r.update({"PreferredVendorID": None}), [("MIS-002", "PreferredVendorID")], "HAWA")
for bad in ["PCS", "kilo", "Each"]:
    mdefect(lambda r, b=bad: r.update({"BaseUoM": b}), [("INC-011", "BaseUoM")])
for bad in ["FINI", "RAW"]:
    mdefect(lambda r, b=bad: r.update({"MaterialType": b}), [("INC-012", "MaterialType")], "FERT")
for bad in ["V29999", "V00001", "20005"]:
    mdefect(lambda r, b=bad: r.update({"PreferredVendorID": b}), [("INC-013", "PreferredVendorID")], "ROH")
for b in blocked_vendors[:2]:
    mdefect(lambda r, b=b: r.update({"PreferredVendorID": b}), [("INC-014", "PreferredVendorID")], "HAWA")
mdefect(lambda r: r.update({"StandardPrice": 0}), [("INC-015", "StandardPrice")])
mdefect(lambda r: r.update({"StandardPrice": -12.5}), [("INC-015", "StandardPrice")])
mdefect(lambda r: r.update({"StandardPrice": "TBD"}), [("INC-015", "StandardPrice")])
mdefect(lambda r: r.update({"GrossWeightKg": -1.2}), [("INC-015", "GrossWeightKg")], "FERT")
for bad in ["9999", "1OOO"]:
    mdefect(lambda r, b=bad: r.update({"Plant": b}), [("INC-017", "Plant")])
mdefect(lambda r: r.update({"Currency": "DOLLAR"}), [("INC-006", "Currency")])
mdefect(lambda r: r.update({"Description": r["Description"].lower()}), [("INC-008", "Description")])
mdefect(lambda r: r.update({"Description": r["Description"] + "  "}), [("INC-008", "Description")])
mdefect(lambda r: r.update({"CreatedDate": "2027-01-09"}), [("INC-009", "CreatedDate")])
mdefect(lambda r: r.update({"Status": "Obsolete"}), [("INC-010", "Status")])
# duplicates
idx = list(range(110)); random.shuffle(idx); pk = iter(idx)
for _ in range(2):  # exact copy with new ID
    src = materials[next(pk)]; r = dict(src); r["MaterialID"] = f"M{mid}"; mid += 1
    materials.append(r); exp("Material", len(materials), "DUP-002", "Description")
src = materials[next(pk)]  # duplicate material ID
r = new_mat(); r["MaterialID"] = src["MaterialID"]; materials.append(r)
exp("Material", len(materials), "DUP-001", "MaterialID")
for kind_ in ["typo", "hyphen", "typo"]:  # fuzzy
    src = materials[next(pk)]
    r = new_mat(src["MaterialType"]); used_desc[src["MaterialType"]].pop()
    d = src["Description"]
    if kind_ == "typo":
        w = d.split(" "); last = w[-1]; i = random.randint(1, len(last) - 3)
        w[-1] = last[:i] + last[i] + last[i:]; nd = " ".join(w)
    else:
        nd = d.replace(" ", "-", 1)
        if norm_name(nd) == norm_name(d):
            nd = d + "s"
    r["Description"] = nd
    materials.append(r)
    assert norm_name(nd) != norm_name(d)
    assert dice(norm_name(nd), norm_name(d)) >= 0.85, (nd, d)
    exp("Material", len(materials), "DUP-005", "Description")

# --------------------------------------------------------------------------
# Shuffle defect rows in among clean rows so they are not all at the bottom,
# keeping expectations aligned to the final row numbers.
# --------------------------------------------------------------------------
def shuffle_rows(rows, entity, keep_first):
    """Shuffle while preserving relative order of rows tied by duplicate rules
    (survivor must stay before its duplicate) - we simply keep the clean block
    first and shuffle only the defect tail among itself."""
    head, tail = rows[:keep_first], rows[keep_first:]
    order = list(range(len(tail))); random.shuffle(order)
    # duplicates reference clean rows (in head), so shuffling the tail is safe
    new_tail = [tail[i] for i in order]
    remap = {keep_first + old + 1: keep_first + new + 1 for new, old in enumerate(order)}
    for e in expected:
        if e["Entity"] == entity and e["Row"] in remap:
            e["Row"] = remap[e["Row"]]
    return head + new_tail


customers = shuffle_rows(customers, "Customer", 150)
vendors = shuffle_rows(vendors, "Vendor", 95)
materials = shuffle_rows(materials, "Material", 110)

for e in expected:
    rows = {"Customer": customers, "Vendor": vendors, "Material": materials}[e["Entity"]]
    idf = {"Customer": "CustomerID", "Vendor": "VendorID", "Material": "MaterialID"}[e["Entity"]]
    e["RecordID"] = rows[e["Row"] - 1][idf]

ref = {
    "Countries": [dict(zip(["CountryCode", "CountryName", "Region", "DefaultCurrency", "PhoneCode",
                            "PostalPattern", "TaxIDPattern", "IBANLength"], c)) for c in COUNTRIES],
    "Lists": [{"ListName": a, "Value": b} for a, b in LISTS],
    "Rules": [{"RuleID": r[0], "Category": r[1], "RuleName": r[2], "AppliesTo": r[3], "Severity": r[4],
               "Enabled": True, "Threshold": r[5], "Description": r[6]} for r in RULES],
    "RequiredFields": [{"Entity": a, "Field": b, "Severity": c} for a, b, c in REQUIRED],
    "Owners": [{"Entity": a, "Region": b, "OwnerName": c, "OwnerEmail": d} for a, b, c, d in OWNERS],
    "Settings": [{"Setting": a, "Value": b, "Notes": c} for a, b, c in SETTINGS],
}
json.dump({"Customers": customers, "Vendors": vendors, "Materials": materials}, open(f"{OUT}/master_data.json", "w"), indent=1)
json.dump(ref, open(f"{OUT}/reference.json", "w"), indent=1)
json.dump({"RunDate": RUN_DATE.isoformat(), "Expected": expected}, open(f"{OUT}/expected_exceptions.json", "w"), indent=1)
print(f"customers={len(customers)} vendors={len(vendors)} materials={len(materials)} expected={len(expected)}")
