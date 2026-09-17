"""Fabrique de vrais relevés : xlsx, xls (BIFF8) et PDF.

Chaque format est produit par un outil indépendant de mon lecteur — openpyxl,
xlwt, LibreOffice — pour que le test ne valide pas mes propres hypothèses.
"""
import datetime as dt
import os
import subprocess
import sys

SORTIE = sys.argv[1] if len(sys.argv) > 1 else '.'
os.makedirs(SORTIE, exist_ok=True)

LIGNES = [
    (dt.date(2026, 9, 1), 'CB BOULANGERIE', -2.50),
    (dt.date(2026, 9, 1), 'CB BOULANGERIE', -2.50),
    (dt.date(2026, 9, 3), 'VIR SALAIRE SEPTEMBRE', 2000.00),
    (dt.date(2026, 9, 5), 'PRLV LOYER', -780.00),
    (dt.date(2026, 9, 8), 'CB LECLERC, ROUEN', -45.20),
    (dt.date(2026, 9, 12), 'RETRAIT DAB DÉCEMBRE', -40.00),
    (dt.date(2026, 9, 14), 'VIR REMBOURSEMENT MUTUELLE', 145.80),
    (dt.date(2026, 9, 15), 'PRLV ASSURANCE HABITATION', -1234.56),
]

# --- xlsx, avec de vraies dates Excel (nombres de série + format) -------------
from openpyxl import Workbook
from openpyxl.styles import Font

classeur = Workbook()
feuille = classeur.active
feuille.title = 'Operations'
feuille.append(['Date operation', 'Libelle', 'Montant', 'Devise'])
for cellule in feuille[1]:
    cellule.font = Font(bold=True)
for date, libelle, montant in LIGNES:
    feuille.append([date, libelle, montant, 'EUR'])
for rang in range(2, len(LIGNES) + 2):
    feuille.cell(row=rang, column=1).number_format = 'DD/MM/YYYY'
    feuille.cell(row=rang, column=3).number_format = '#,##0.00'
# Une seconde feuille, pour vérifier qu'on lit bien la première par défaut.
autre = classeur.create_sheet('Notes')
autre.append(['Ceci', 'ne doit pas', 'etre importe'])
classeur.save(os.path.join(SORTIE, 'releve.xlsx'))

# --- xlsx en colonnes débit / crédit, dates en texte --------------------------
classeur2 = Workbook()
f2 = classeur2.active
f2.title = 'Releve'
f2.append(['Date', 'Nature', 'Debit', 'Credit'])
for date, libelle, montant in LIGNES:
    f2.append([
        date.strftime('%d/%m/%Y'),
        libelle,
        f'{abs(montant):.2f}'.replace('.', ',') if montant < 0 else '',
        f'{montant:.2f}'.replace('.', ',') if montant > 0 else '',
    ])
classeur2.save(os.path.join(SORTIE, 'releve-debit-credit.xlsx'))

# --- xls, format binaire d'Excel 97 ------------------------------------------
import xlwt

cahier = xlwt.Workbook(encoding='utf-8')
onglet = cahier.add_sheet('Operations')
style_date = xlwt.easyxf(num_format_str='DD/MM/YYYY')
onglet.write(0, 0, 'Date operation')
onglet.write(0, 1, 'Libelle')
onglet.write(0, 2, 'Montant')
for rang, (date, libelle, montant) in enumerate(LIGNES, start=1):
    onglet.write(rang, 0, date, style_date)
    onglet.write(rang, 1, libelle)
    onglet.write(rang, 2, montant)
cahier.save(os.path.join(SORTIE, 'releve.xls'))

# --- xlsx écrit par XlsxWriter : chaînes partagées, pas en ligne ---------------
# Excel lui-même range les libellés dans une table commune et n'écrit dans les
# cellules qu'un renvoi. openpyxl, lui, écrit le texte sur place : sans ce
# second écrivain, tout un chemin de lecture resterait sans épreuve.
import xlsxwriter

livre = xlsxwriter.Workbook(os.path.join(SORTIE, 'releve-partage.xlsx'),
                            {'default_date_format': 'dd/mm/yyyy'})
page = livre.add_worksheet('Operations')
gras = livre.add_format({'bold': True})
fdate = livre.add_format({'num_format': 'dd/mm/yyyy'})
for col, titre in enumerate(['Date operation', 'Libelle', 'Montant']):
    page.write(0, col, titre, gras)
for rang, (date, libelle, montant) in enumerate(LIGNES, start=1):
    page.write_datetime(rang, 0, dt.datetime(date.year, date.month, date.day), fdate)
    page.write_string(rang, 1, libelle)
    page.write_number(rang, 2, montant)
# Une formule, avec son résultat en cache : certaines banques calculent le solde
# courant dans une colonne. La formule ne doit jamais se retrouver dans le
# montant importé.
page.write_formula(len(LIGNES) + 1, 2, '=SUM(C2:C9)', None, round(sum(m for _, _, m in LIGNES), 2))
page.write_string(len(LIGNES) + 1, 1, 'TOTAL')
livre.close()

# --- xls dont la table de textes déborde sur des continuations -----------------
# Un enregistrement BIFF ne dépasse pas 8 224 octets : au-delà, la table des
# libellés se poursuit dans des enregistrements « CONTINUE », dont chacun
# recommence par son propre octet d'encodage. C'est le piège le plus coûteux du
# format, et il ne se déclenche qu'avec beaucoup de texte.
gros = xlwt.Workbook(encoding='utf-8')
onglet2 = gros.add_sheet('Operations')
onglet2.write(0, 0, 'Date operation')
onglet2.write(0, 1, 'Libelle')
onglet2.write(0, 2, 'Montant')
for rang in range(1, 401):
    jour = dt.date(2026, 1, 1) + dt.timedelta(days=rang % 350)
    onglet2.write(rang, 0, jour, style_date)
    # Des libellés longs, tous différents, dont un sur trois porte un accent :
    # c'est le changement d'encodage au milieu de la table qu'on veut atteindre.
    accent = ' RETRAIT DÉCEMBRE ŒUVRE' if rang % 3 == 0 else ''
    onglet2.write(rang, 1, f'OPERATION NUMERO {rang:04d} CHEZ UN COMMERCANT AU NOM TRES LONG{accent}')
    onglet2.write(rang, 2, round(-1.11 * rang, 2))
gros.save(os.path.join(SORTIE, 'releve-long.xls'))

# --- PDF façon relevé bancaire mis en page ------------------------------------
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

chemin = os.path.join(SORTIE, 'releve-banque.pdf')
c = canvas.Canvas(chemin, pagesize=A4)
largeur, hauteur = A4
c.setFont('Helvetica-Bold', 14)
c.drawString(40, hauteur - 50, 'BANQUE DE L’OUEST')
c.setFont('Helvetica', 9)
c.drawString(40, hauteur - 68, 'Relevé de compte n° 0123456789 — septembre 2026')
c.setFont('Helvetica-Bold', 9)
y = hauteur - 100
c.drawString(40, y, 'Date')
c.drawString(100, y, 'Libellé')
c.drawRightString(420, y, 'Débit')
c.drawRightString(520, y, 'Crédit')
c.line(40, y - 4, 520, y - 4)
c.setFont('Helvetica', 9)
y -= 20
for date, libelle, montant in LIGNES:
    c.drawString(40, y, date.strftime('%d/%m/%Y'))
    c.drawString(100, y, libelle)
    texte = f'{abs(montant):,.2f}'.replace(',', ' ').replace('.', ',')
    if montant < 0:
        c.drawRightString(420, y, texte)
    else:
        c.drawRightString(520, y, texte)
    y -= 16
c.line(40, y + 6, 520, y + 6)
c.setFont('Helvetica-Bold', 9)
c.drawString(40, y - 10, 'SOLDE AU 30/09/2026')
c.drawRightString(520, y - 10, '2 041,04')
c.showPage()
c.save()

for nom in sorted(os.listdir(SORTIE)):
    if nom.split('.')[-1] in ('xlsx', 'xls', 'pdf'):
        print(nom, os.path.getsize(os.path.join(SORTIE, nom)), 'octets')
