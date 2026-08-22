import pymupdf, pathlib
out = pathlib.Path('data/pnp-pages'); out.mkdir(parents=True, exist_ok=True)
for pdf in ['docs/rules/print-and-play-arasaka.pdf', 'docs/rules/print-and-play-mercs.pdf']:
    doc = pymupdf.open(pdf)
    stem = pathlib.Path(pdf).stem
    for i, page in enumerate(doc):
        page.get_pixmap(dpi=200).save(out / f'{stem}-p{i+1}.png')
print('done')
