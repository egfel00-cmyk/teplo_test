# Довідник населених пунктів Харківської області з КАТОТТГ → app/data/kh_katottg.json (для «Постачальники й тарифи» за адресою).
# Джерело: github.com/suprun/katottg.json (КАТОТТГ у JSON, MIT). Запуск: python3 -I tools_katottg.py <шлях до katottg.json> [<старий katottg.json для перейменувань>]
# Наружу файл не віддається (tools_* закрито); результат — у app/data.
import json, sys
def load(p):
    d = json.load(open(p, encoding='utf-8')); au = d['admin_units'] if 'admin_units' in d else d[list(d.keys())[-1]]
    return d, [x for x in au if x.get('level_1') == 'UA63000000000041885']
d, xs = load(sys.argv[1])
P = {x['id']: x['name'] for x in xs if x['category'] == 'P'}
H = {x['id']: {'n': x['name'], 'd': x['level_2']} for x in xs if x['category'] == 'H'}
S = [{'n': x['name'], 'c': x['category'], 'h': x['level_3'], 'd': x['level_2'], 'id': x['id']} for x in xs if x['category'] in 'MXC']
renamed = {}
if len(sys.argv) > 2:
    _, old = load(sys.argv[2]); cur = {x['id']: x['name'] for x in xs}
    renamed = {x['id']: x['name'] for x in old if x['id'] in cur and cur[x['id']] != x['name']}
# старі назви, якими ще пишуть адреси (перейменування 2016–2024)
OLD = {'Берестин': ['Красноград'], 'Златопіль': ['Первомайський'], 'Південне': ['Южний', 'Южное', 'Южный']}
# громади, перейменовані слідом за центром (2024), у КАТОТТГ ще під старими назвами
H_NEW = {'Красноградська': 'Берестинська', 'Первомайська': 'Златопільська'}
for h in H.values(): h['n'] = H_NEW.get(h['n'], h['n'])
for s in S:
    # старі назви — лише місту (у Солоницівській громаді є село Південне, яке Южним не було)
    al = (list(OLD.get(s['n'], [])) if s['c'] == 'M' else []) + ([renamed[s['id']]] if s['id'] in renamed else [])
    if al: s['old'] = al
out = {'src': 'КАТОТТГ (github.com/suprun/katottg.json), станом на ' + str(d.get('valid_on', '')), 'districts': P, 'hromadas': H,
       'settlements': [{k: v for k, v in s.items() if k != 'id'} for s in S]}
json.dump(out, open('app/data/kh_katottg.json', 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(len(P), 'районів,', len(H), 'громад,', len(S), 'пунктів,', sum(1 for s in S if 'old' in s), 'зі старими назвами')
