# Перелік «Адреси та черги» Харківобленерго (PDF, таблиця Calc: текст + X у колонці черги) → сирий довідник адрес.
#   python3 -I tools_gpv_parse.py list.pdf raw.json    (потрібен pdfplumber)
# Далі: php tools_gpv_index.php raw.json app/data/gpv_addr.json — ключі для пошуку рахує той самий код, що й сервер (Gpv::skel).
# Текст у клітинках дуже різний («Валки м., Харківська вул.; …», «смт. Солоницівка: вул. Заводська, №6, 9», «м. Люботин, Низовая, …»),
# тож розбір наближений: населений пункт → його вулиці → номери будинків. Підприємства (ТОВ, ПАТ, ТРЦ…) пропускаємо.
import json, re, sys
import pdfplumber

QN = ['1.1', '1.2', '2.1', '2.2', '3.1', '3.2', '4.1', '4.2', '5.1', '5.2', '6.1', '6.2']
CAP = "[А-ЯІЇЄҐA-Z]"
W = "[\\w'’ʼ\\-]"
STYPES = r"вулиця|улица|вул|ул|провулок|переулок|пров|пер|в-д|в'їзд|в’їзд|вʼїзд|в-зд|проїзд|пр-зд|пр-т|просп|проспект|пр|пл|площа|б-р|бульв|бульвар|туп|тупик|узвіз|шосе|м-н|мкр|мікрорайон|майдан|наб|набережна|лінія"
# лише малими: «Г.Шабалдіна», «М.Вербицького», «М.Рогань» — це ініціали, а не «г.»/«м.»; «Смт Рогань» — окремо
SET_PRE = r"смт|селище|село|сел|сщ|місто|пос|м|г|с|х"
SET_PRE_CAP = SET_PRE + r"|Смт|Село|Селище|Місто"
COMP = r"(?:ТОВ|ПАТ|ПраТ|ПрАТ|АТ|ТРЦ|ОДО|ООО|ФОП|ТДВ|ПФ|КП|ДП|ПП|ЧП|МЧФ|УОРА|Концерн|КЛАСС|РОСТ|З-д|Інститут|Новожаніський)"
COMPANY = re.compile(r'^\s*' + COMP + r'\b', re.I)

def clean(t):
    t = t.replace('\n', ' ').replace('–', '-').replace('—', ' — ').replace('“', '"').replace('”', '"').replace('«', '"').replace('»', '"')
    t = re.sub(r"[А-ЯІЇЄҐ][а-яіїєґ'’]+(?:ський|цький|ский)\s+р-?н\.?", ';', t)          # райони — роздільник
    t = re.sub(r"\b[А-ЯІЇЄҐ][а-яіїєґ'’]+(?:ська|цька)\s+(?:т-г|тг|сільська рада|селищна рада|с/р)\b\.?", ';', t)
    t = re.sub(r'\((?:ШРЭС|ШРЕС|частково)\)', ' ', t)
    t = re.sub(r'№\s*№', '№', t)
    t = re.sub(r'с\.\s*м\.\s*т\.?', 'смт', t)                                              # «с.м.т. Нова Водолага»
    t = re.sub(r'\b(смт|с|м)\s*,\s*(?=[А-ЯІЇЄҐ])', r'\1 ', t)                                 # «смт ,Васищеве»
    t = re.sub(r'(?<![\w.])[cC]\.(?=\s*[А-ЯІЇЄҐ])', 'с.', t)                                   # латинська «c. Трійчате»
    t = re.sub(r'(?<![\w.])п\.(?=\s*[А-ЯІЇЄҐ][а-яіїєґ\'’]{3})', 'сел.', t)                    # «п.Близнюки» — селище
    t = re.sub(r'\s*\(?\bчастково\b\)?', ' ', t)                                          # «Благовіщінська частково»
    t = re.sub(r'\s\.(?=[^\s\d.,;])', ' ', t)                                             # «Феськи .с. Головашевка»
    t = re.sub(r"(?<=[а-яіїєґ'’])\s*-\s*(вул|пров|пер)\.?\s*:?\s*", r' \1 ', t)            # «с.Лиман-вул.Андреївська», «Таранівка- вул.»
    # крапка скорочення — не кінець речення: «вул. Заводська», «смт. Солоницівка», «с.Піски» → «вул Заводська» (інакше рядок ріжеться
    # на «… вул» + «Заводська», і в селах вулиці стають новими селами)
    t = re.sub(r"(?<![\w'’ʼ.\-])(" + STYPES + "|" + SET_PRE + r")\.\s*", r'\1 ', t)
    return re.sub(r'\s+', ' ', t).strip()

def is_house(tok):
    tok = tok.strip()
    return bool(re.fullmatch(r'(?:№|буд\.?|д\.)?\s*\d+\s*[а-яіa-z]?(?:\s*[-/]\s*\d+\s*[а-яіa-z]?)?', tok, re.I))

def houses(tok):
    tok = re.sub(r'(?:№|буд\.?|д\.)', ' ', tok, flags=re.I).strip()
    m = re.fullmatch(r'(\d+)\s*-\s*(\d+)', tok)
    if m and int(m.group(2)) - int(m.group(1)) <= 400 and int(m.group(2)) > int(m.group(1)):
        return [str(i) for i in range(int(m.group(1)), int(m.group(2)) + 1)]
    return [re.sub(r'\s+', '', tok).lower()]

def parse_cell(text, q):
    t = clean(text)
    if COMPANY.match(t): return []
    items, city, street, sflag, kind = [], None, None, False, ''   # sflag — у цього пункту вже були вулиці; kind — м/смт/с
    cur = None   # запис «увесь пункт»: якщо далі йдуть його вулиці — лише ці вулиці, не весь пункт (запис потім прибираємо)
    def add_city(name, k=''):
        nonlocal city, street, sflag, kind, cur
        kind = k.lower()
        name = re.sub(r'\s+(?:м|с|смт|сел)$', '', re.sub(r'\s+', ' ', name).strip(" .,'’"))
        if len(name) < 3: return
        city = name[0].upper() + name[1:]; street = None; sflag = False
        cur = {'c': city, 's': '', 'h': None, 'q': q}; items.append(cur)
    def add_street(name, typ=''):
        nonlocal street, sflag
        name = re.sub(r'\s+', ' ', name).strip(" .,'’")
        if city is None or len(name) < 3 or not re.search('[а-яіїєґА-ЯІЇЄҐ]{3}', name): return
        street = {'c': city, 's': (typ + ' ' + name).strip(), 'h': None, 'q': q}; sflag = True
        if cur is not None: cur['_st'] = True
        items.append(street)
    # роздільники: ; , : ( ) і тире; кінець речення «Гагаріна. Далі»; перед «с Караван» / «смт Рогань» усередині шматка
    toks = re.split(r"[;,:()]|\s+[—-]\s+|(?<=[а-яіїєґ]{3})\.\s*(?=" + CAP + r")|(?<=\s)(?=(?:" + SET_PRE_CAP + r")\s+" + CAP + ")", t)
    for tok in toks:
        tok = (tok or '').strip(" .")
        if not tok: continue
        if is_house(tok):
            if street is not None:
                street['h'] = (street['h'] or []) + houses(tok)
            continue
        # «с. Качалівка вул. Комарова» / «смт. Солоницівка» / «м.Лозова»
        # назва може починатися з ініціала: «с. М.Рогань», «с.Ч.Бишкин», «сел. Ст.Ріпки»; друге слово — не тип вулиці й не «ПАТ»
        m = re.match(r"(" + SET_PRE_CAP + r")(?:\.\s*|\s+)((?:[А-ЯІЇЄҐ][а-яіїєґ]?\.\s*)?[А-ЯІЇЄҐа-яіїєґ]" + W + r"*(?:\s+(?!(?i:" + STYPES + r")\b)(?!" + COMP + r"\b)" + CAP + W + r"*)?)(.*)$", tok)
        if m:
            nm = m.group(2)
            if nm[:1].islower(): nm = nm[0].upper() + nm[1:]
            add_city(nm, m.group(1)); rest = m.group(3).strip(" .")
            if not rest: continue
            if COMPANY.match(rest):   # «Смт Рогань ПАТ "…ФАБРИКА"» — лише підприємство, не весь пункт
                if cur is not None: cur['_st'] = True
                continue
            tok = rest
        # «Валки м.» / «Гузівка с.» / «Ков'яги смт.»
        m = re.match(r"(" + CAP + W + r"*(?:\s+" + CAP + W + r"*)?)\s+(м|с|смт|сел|сщ)\.?(?:\s+(.*))?$", tok)
        if m:
            add_city(m.group(1), m.group(2)); rest = (m.group(3) or '').strip(" .")
            if not rest: continue
            tok = rest
        # «вул. Заводська №6» / «вул.Нижня»
        m = re.match(r"(?i:(" + STYPES + r"))(?:\.\s*|\s+)(.+?)(?:\s*(?:№|буд\.?)\s*(.+))?$", tok)
        if m and re.search('[а-яіїєґА-ЯІЇЄҐ]{3}', m.group(2)):
            add_street(re.sub(r'\s*\d.*$', '', m.group(2)) or m.group(2), m.group(1).lower() + '.')
            hs = m.group(3) or (re.search(r'\s(\d+\s*[а-яі]?(?:\s*-\s*\d+)?)$', m.group(2)) or [None, None])[1]
            if hs and street is not None: street['h'] = (street['h'] or []) + houses(hs)
            continue
        # «Харківська вул.» / «Залізничний пров.»
        m = re.match(r"(.+?)\s+(?i:(" + STYPES + r"))\.?$", tok)
        if m: add_street(m.group(1), m.group(2).lower() + '.'); continue
        # голе ім'я: після вулиць цього пункту — вулиця, інакше — ще один населений пункт («с. Лагідне, Кінне, Олександрівка»)
        if re.match(CAP, tok) and len(tok) <= 40 and not COMPANY.match(tok) and '"' not in tok and not re.search(r'\d{2,}|котельн|школ|сш|аптек|маг\.|д/сад|тп|рп|кооператив', tok, re.I):
            if sflag or kind in ('м', 'г', 'смт', 'місто'): add_street(tok)
            elif city is not None and len(items) and items[-1]['s'] == '': add_city(tok, kind)
    # «смт Солоницівка: вул. …» — лише ці вулиці; «весь пункт» лишаємо тільки там, де вулиць не перелічено
    return [{k: v for k, v in x.items() if k != '_st'} for x in items if not x.get('_st')]

def main(src, dst):
    pdf = pdfplumber.open(src); rows = []
    for page in pdf.pages:
        for tb in page.extract_tables():
            for r in tb:
                cells = [(c or '').strip() for c in r]
                if len(cells) != 13: continue
                xs = [i for i, c in enumerate(cells[1:]) if c.upper() in ('X', 'Х')]
                if len(xs) == 1 and cells[0]: rows.append((cells[0], QN[xs[0]]))
    items = []
    for text, q in rows: items += parse_cell(text, q)
    # однакові записи (пункт + вулиця + черга) зливаємо, номери будинків — разом
    merged = {}
    for it in items:
        k = (it['c'].lower(), it['s'].lower(), it['q'], it['h'] is None)
        if k in merged and it['h']: merged[k]['h'] = sorted(set(merged[k]['h'] + it['h']))
        elif k not in merged: merged[k] = dict(it)
    out = list(merged.values())
    json.dump({'rows': len(rows), 'items': out}, open(dst, 'w'), ensure_ascii=False)
    print('рядків', len(rows), 'записів', len(out), 'пунктів', len({i['c'].lower() for i in out}), 'вулиць', sum(1 for i in out if i['s']), 'з будинками', sum(1 for i in out if i['h']))

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
