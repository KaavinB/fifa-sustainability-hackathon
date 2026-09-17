#!/usr/bin/env python3
"""Stream a huge .xlsx down to the few columns that matter, as CSV.

    python3 tools/xlsx-to-csv.py <in.xlsx> <out.csv>

The source sheet is 2 GB of XML uncompressed. openpyxl can read it, but it
builds objects per cell and takes an age; this walks the XML with iterparse
and clears as it goes, so memory stays flat regardless of row count.

Only the requested columns are kept. Deliberately dropped: Contact, Phone,
Fax, names, Gender and Ethnic — named individuals with demographics have no
analytical use here and should not travel with a public demo.
"""
import csv, re, sys, zipfile
import xml.etree.ElementTree as ET

WANTED = [
    'OBJECTID', 'FID', 'Company', 'PriAddr', 'PriCity', 'PriSt', 'PriZip',
    'PriZip10', 'Latitude', 'Longitude', 'PriSic', 'NaicsCd', 'Naics',
    'AcLocEmpSz', 'ModEmpSz',
]
NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'


def col_index(ref):
    """'BC12' -> 54. Spreadsheet columns are base-26 with no zero."""
    letters = re.match(r'([A-Z]+)', ref).group(1)
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def cell_text(cell):
    inline = cell.find(f'{NS}is/{NS}t')
    if inline is not None:
        return inline.text or ''
    v = cell.find(f'{NS}v')
    return (v.text or '') if v is not None else ''


def main():
    src, dst = sys.argv[1], sys.argv[2]
    shared = []

    with zipfile.ZipFile(src) as z:
        if 'xl/sharedStrings.xml' in z.namelist():
            with z.open('xl/sharedStrings.xml') as f:
                for _, el in ET.iterparse(f):
                    if el.tag == f'{NS}si':
                        shared.append(''.join(t.text or '' for t in el.iter(f'{NS}t')))
                        el.clear()
            print(f'  {len(shared):,} shared strings')

        with z.open('xl/worksheets/sheet1.xml') as f, open(dst, 'w', newline='') as out:
            writer = csv.writer(out)
            keep, header_row = None, None
            rows = kept = 0

            for _, el in ET.iterparse(f, events=('end',)):
                if el.tag != f'{NS}row':
                    continue

                values = {}
                for c in el.findall(f'{NS}c'):
                    text = cell_text(c)
                    # A cell typed "s" indexes the shared-string table.
                    if c.get('t') == 's' and text.isdigit():
                        text = shared[int(text)] if int(text) < len(shared) else ''
                    values[col_index(c.get('r', 'A1'))] = text

                if keep is None:
                    header_row = values
                    lower = {v.strip().lower(): k for k, v in values.items() if v}
                    keep = []
                    for name in WANTED:
                        idx = lower.get(name.lower())
                        if idx is None:
                            print(f'  !! column not found: {name}')
                        else:
                            keep.append((name, idx))
                    writer.writerow([n for n, _ in keep])
                    print(f'  keeping {len(keep)} of {len(values)} columns')
                else:
                    writer.writerow([values.get(i, '') for _, i in keep])
                    kept += 1

                rows += 1
                if rows % 100_000 == 0:
                    print(f'  {rows:,} rows…', flush=True)
                el.clear()

    print(f'done: {kept:,} data rows -> {dst}')
    void = header_row  # kept for debugging a mismatched header
    del void


if __name__ == '__main__':
    main()
