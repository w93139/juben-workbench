import { describe, expect, it } from "vitest";
import { EVALUATION_TASK_VERSION, evaluationTasks, safeParseEvaluationJson } from "@/server/evaluation-tasks";

const structure = () => ({
  facts: [
    { statement: "顾遥完成钥匙交接", sourceQuote: "A：21:40，顾遥把钥匙交给林川。", kind: "明确事实" },
    { statement: "监控记录林川仍在北厅", sourceQuote: "B：22:10，监控记录林川仍在北厅。", kind: "明确事实" },
    { statement: "北厅门锁已经内部反锁", sourceQuote: "C：22:05，北厅门锁已从内部反锁。", kind: "明确事实" },
  ],
  inferences: [{ statement: "林川与反锁事件的关系仍需进一步查证", supportQuotes: ["22:05，北厅门锁已从内部反锁。", "22:10，监控记录林川仍在北厅。"] }],
  causalChain: ["21:40交接钥匙", "22:05北厅反锁", "22:10监控仍见林川"], unknowns: ["监控时钟是否准确"],
});
const direction = () => ({
  title: "潮汐账本", premise: "海上研究站即将沉没，每个人持有不同撤离记录，公开时机会改变同伴的信任与救援决定。",
  playerBehaviors: ["决定公开记录的先后顺序", "根据信任关系交换局部记录"],
  originalChanges: ["重建全部人物身份与角色关系", "重建隐瞒记录的个人动机", "重建研究站撤离事故及完整因果", "重建分轮获得的信息与证据线索"],
  risks: ["公开信息过多可能造成阅读拥堵", "强势玩家可能垄断公开顺序"],
});
const grade = (index: number, data: unknown) => evaluationTasks[index]!.grade(data, JSON.stringify(data));

describe("测评题目和评分契约", () => {
  it("新版本明确区分旧题成绩，合法带句号和标签的逐字引用得到证据满分", () => {
    expect(EVALUATION_TASK_VERSION).toBe("juben-model-eval/1.1");
    expect(grade(0, structure())).toMatchObject({ evidence: 100, structure: 100, format: 100 });
  });
  it("省略末尾句号和标签仍可正确回查", () => {
    const data = structure(); data.facts = data.facts.map(item => ({ ...item, sourceQuote: item.sourceQuote.replace(/^[ABC]：/, "").replace(/。$/, "") }));
    expect(grade(0, data).evidence).toBe(100);
  });
  it("修改时间或人物的引用不会被规范化为正确证据", () => {
    const data = structure(); data.facts[0]!.sourceQuote = "A：21:50，顾遥把钥匙交给别人。";
    expect(grade(0, data).evidence).toBeLessThan(100);
  });
  it("事件链逆序排列不能获得结构满分，即使包含全部关键词", () => {
    const data = structure(); data.causalChain.reverse();
    const result = grade(0, data);
    expect(result.structure).toBe(53); expect(result.evidence).toBe(100);
    expect(result.notes).toContain("事件链未按21:40、22:05、22:10顺序分别列出对应事件");
  });
  it("把三个时间和事件堆在同一个节点不能骗取三个顺序节点的分数", () => {
    const data = structure(); data.causalChain = ["21:40交接钥匙；22:05北厅反锁；22:10监控仍见林川", "这些属于明确事实", "仍需查明事件因果"];
    expect(grade(0, data).structure).toBe(53);
  });
  it("不足条数报告明确字段和固定原因，题目明示同一约束", () => {
    const data = direction(); data.risks = [data.risks[0]!];
    const result = grade(1, data);
    expect(result.format).toBe(0); expect(result.notes).toContain("风险：条数或字数少于题目要求");
    expect(evaluationTasks[1]!.prompt).toContain("risks为2—6条");
    expect(evaluationTasks[1]!.prompt).toContain("originalChanges为4—8条");
    expect(evaluationTasks[1]!.prompt).toContain("premise为25—500字");
  });
  it("额外展示字段不使完整回答全项归零", () => {
    const data = structure();
    const result = grade(0, { ...data, explanation: "额外展示信息", facts: data.facts.map(item => ({ ...item, confidence: 0.9 })) });
    expect(result).toMatchObject({ evidence: 100, format: 100 });
  });
  it("普通事故一词不受惩罚，沿用具体人物仍扣分", () => {
    expect(grade(1, direction()).originality).toBe(100);
    const data = direction(); data.premise += "林川参与了撤离。";
    expect(grade(1, data).originality).toBe(80);
  });
  it("非JSON与字段错误分别诊断，错误明细不泄露响应正文", () => {
    const secretText = "arbitrary-provider-secret-text";
    const invalid = evaluationTasks[0]!.grade(null, secretText);
    expect(invalid.format).toBe(0); expect(invalid.notes.join("")).toContain("不是可读取的JSON");
    expect(invalid.notes.join("")).not.toContain(secretText);
    const data = structure(); data.facts[0]!.kind = secretText;
    const badField = grade(0, data);
    expect(badField.notes).toContain("明确事实／第1项／信息类别：取值不在题目规定范围");
    expect(badField.notes.join("")).not.toContain(secretText);
  });
  it("支持完整JSON代码块，但不把周围自然语言偷改为答案", () => {
    expect(safeParseEvaluationJson(" \n```json\n{\"a\":1}\n```\n")).toEqual({ a: 1 });
    expect(safeParseEvaluationJson("这是答案：{\"a\":1}")).toBeNull();
  });
  it("一致性题明确摄像头断电且无备用电源，避免把未说明前提当成确定矛盾", () => {
    expect(evaluationTasks[2]!.prompt).toContain("所有区域持续断电");
    expect(evaluationTasks[2]!.prompt).toContain("没有备用电源");
    expect(evaluationTasks[2]!.prompt).toContain("findings为2—6条");
    const result = grade(2, { findings: [
      { category: "时间线矛盾", evidence: "20:00以后摄像头已停止工作", proposal: "改为现场人员目击并明确其观察位置" },
      { category: "线索缺口", evidence: "没有任何进入密室的可获得线索", proposal: "增加门禁记录与可获得的脚印线索" },
    ], verdict: "阻断" });
    expect(result).toMatchObject({ evidence: 100, format: 100 });
  });
});
