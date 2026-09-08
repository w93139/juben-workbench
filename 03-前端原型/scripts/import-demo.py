"""只读参考目录，重建应用自己的演示快照；应用运行时不需要原目录。"""
from pathlib import Path
import hashlib
import json
import shutil

APP = Path(__file__).resolve().parents[1]
SOURCE = APP.parent / '02-演示与测试资料' / '名字之外-原创剧本项目'
DEST = APP / 'src' / 'mocks'
DEST.mkdir(parents=True, exist_ok=True)
sources = []

def read(relative):
    payload = (SOURCE / relative).read_bytes()
    sources.append({'path': relative, 'sha256': hashlib.sha256(payload).hexdigest(), 'label': Path(relative).name})
    return payload.decode('utf-8')

def data(name):
    return json.loads(read('02-原创设计蓝图-v0.3/数据/' + name))

canon = data('01-客观底稿.json')
cast = data('02-人物关系与知识.json')
evidence = data('03-线索与推理链.json')
flow = data('04-轮次与主持状态.json')
status = json.loads(read('06-项目数据/项目状态.json'))
static = json.loads(read('01-完整剧本-v1.0/08-成品审查/静态检查结果.json'))
version = json.loads(read('01-完整剧本-v1.0/数据/版本状态.json'))
decisions = data('07-决策状态.json')

def text(value):
    if isinstance(value, str): return value
    if isinstance(value, list): return '；'.join(text(item) for item in value)
    return json.dumps(value, ensure_ascii=False)

docs = []
for doc_id, name, label in [
    ('overview', '00-先看这里.md', '原创项目说明'),
    ('review', '03-交叉验证记录/00-验证说明.md', '交叉验证的范围'),
    ('kit', '01-完整剧本-v1.0/00-使用说明/00-README-开本顺序.md', '开本材料与发放顺序'),
]:
    content = read(name)
    docs.append({'id': doc_id, 'title': label, 'source': name, 'content': content})
    (DEST / 'documents').mkdir(exist_ok=True)
    shutil.copyfile(SOURCE / name, DEST / 'documents' / f'{doc_id}.md')

decision_source = '02-原创设计蓝图-v0.3/数据/07-决策状态.json'
demo = {
    'title': status['official_title'].strip('《》'),
    'premise': canon['premise'], 'blueprintVersion': 'v0.3', 'kitVersion': 'v1.0',
    'players': status['players'], 'plannedMinutes': status['planned_play_minutes'],
    'deliverables': [{'label': label, 'complete': bool(version['deliverables'][key])} for key, label in [('rolebooks', '角色本'), ('private_notes', '私人批注'), ('private_updates', '阶段更新'), ('base_clues', '公共线索'), ('host_manual', '主持手册'), ('ending_kit', '终局材料')]],
    'sources': sources,
    'characters': [{'id': r['id'], 'name': r['name'], 'publicIdentity': r['public_identity'], 'goal': r['immediate_goal'], 'privateInformation': text(r['concealment']), 'choice': text(r['choice']), 'contribution': text(r['leverage'])} for r in cast['roles']],
    'relationships': [{'id': r['id'], 'participants': r['participants'], 'basis': text(r['basis']), 'priority': r['priority'], 'publicVersion': r['public_version'], 'underlyingFacts': r['underlying_facts'], 'leverage': r['leverage'], 'statusLabel': r['tag']} for r in cast['relationships']],
    'events': [{'id': e['id'], 'time': text(e['time']), 'location': text(e['location']), 'action': text(e['action'])} for e in canon['events']],
    'knowledge': [{'id': k['id'], 'kind': k['kind'], 'statement': k['fact'], 'initial': k['initial']} for k in cast['knowledge_matrix']],
    'clues': [{'id': c['id'], 'name': c['name'], 'content': c['content'], 'cost': c['cost'], 'supports': c['supports']} for c in evidence['clues']],
    'claims': [{'id': c['id'], 'statement': c['claim'], 'tier': c['tier']} for c in evidence['claims']],
    'rounds': [{'id': r['id'], 'name': r['name'], 'minutes': r['planned_minutes']} for r in flow['stages']],
    'mechanisms': [{'id': m['id'], 'name': m['name'], 'sourcePattern': m['source_pattern']} for m in canon['mechanics']],
    'checks': [
        {'id': 'ai-blueprint', 'kind': 'ai', 'label': 'AI结构审查', 'result': '双模型交叉审查已完成', 'scope': '原创蓝图 v0.3 · 历史修订记录', 'source': '03-交叉验证记录/00-验证说明.md', 'origin': 'historical'},
        {'id': 'static-kit', 'kind': 'static', 'label': '静态一致性检查', 'result': f"{static['checks_passed']} / {static['checks_total']} 项通过", 'scope': '完整开本包 v1.0 · 既有检查结果', 'source': '01-完整剧本-v1.0/08-成品审查/静态检查结果.json', 'origin': 'historical'},
        {'id': 'simulation', 'kind': 'simulation', 'label': '玩家模拟测试', 'result': '未执行', 'scope': '结构检查不等于玩家模拟', 'source': None, 'origin': 'not-run'},
        {'id': 'human', 'kind': 'human', 'label': '真人试玩', 'result': '尚未真人试玩', 'scope': '下一步：至少两桌盲测', 'source': '06-项目数据/项目状态.json', 'origin': 'not-run'},
    ],
    'documents': docs,
    'decisions': [
        {'id': 'experience', 'title': '推理还原为主，关系选择为辅', 'detail': decisions['confirmed'][0], 'status': 'confirmed', 'nature': 'original', 'source': decision_source},
        {'id': 'cast', 'title': '五名独立角色，一位主持人', 'detail': '五名独立成年人，角色性别可调，无强制恋爱。', 'status': 'confirmed', 'nature': 'original', 'source': decision_source},
        {'id': 'duration', 'title': '计划时长 225 分钟', 'detail': decisions['provisional'][0], 'status': 'provisional', 'nature': 'inference', 'source': decision_source},
        {'id': 'participation', 'title': '观察五位角色的参与程度', 'detail': decisions['open_for_human_test'][1], 'status': 'open', 'nature': 'unresolved', 'source': decision_source},
    ],
}
(DEST / 'names-beyond.json').write_text(json.dumps(demo, ensure_ascii=False, indent=2) + '\n')
print(f"演示快照：{len(demo['characters'])}角色 / {len(demo['relationships'])}关系 / {len(demo['knowledge'])}知识 / {len(demo['clues'])}公共材料；原资料未修改。")
