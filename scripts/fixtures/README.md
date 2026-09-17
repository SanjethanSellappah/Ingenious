# Fichiers d'épreuve

Les lecteurs de relevé (`src/core/xlsx.ts`, `xls.ts`, `pdf.ts`) sont éprouvés
sur de **vrais fichiers**, rangés dans `src/core/__fixtures__/`.

C'est une exigence, pas une commodité. Un lecteur de format vérifié sur des
fichiers qu'il a lui-même fabriqués ne vérifie que la cohérence de ses propres
hypothèses : il passera tous les tests et échouera sur le premier relevé réel.
Chaque fichier est donc produit par un outil qui ne partage aucun code avec ces
lecteurs — et deux écrivains différents pour le `.xlsx`, parce qu'ils ne font
pas les mêmes choix.

| Fichier | Écrit par | Ce qu'il met à l'épreuve |
| --- | --- | --- |
| `releve.xlsx` | openpyxl | dates en numéro de série, texte écrit dans la cellule, deux feuilles |
| `releve-partage.xlsx` | XlsxWriter | libellés rangés dans la table commune, formule avec résultat en cache |
| `releve-debit-credit.xlsx` | openpyxl | colonnes débit et crédit séparées, dates en texte |
| `releve.xls` | xlwt | conteneur OLE2, nombres compressés, format de 1997 |
| `releve-long.xls` | xlwt | table des textes qui déborde sur quatre continuations |
| `releve-banque.pdf` | ReportLab | texte positionné, colonnes à retrouver, accents en octal |

## Refabriquer

```sh
pip install openpyxl xlsxwriter xlwt reportlab
python3 scripts/fixtures/releves.py src/core/__fixtures__
```

Les fichiers sont reproductibles à l'octet près, à l'exception du PDF, qui porte
sa date de fabrication. Les tests ne regardent que son contenu.
