import { test, expect } from "@playwright/test";
import { seedProject } from "./project-fixture";
test("未连接有明确设置入口，保存配置刷新状态且不外呼模型或存浏览器密钥",async({page})=>{
  let saved=false, calls=0;
  const safe={baseUrl:"",mainModel:"",reviewA:"",reviewB:"",hasApiKey:false,configured:false,source:"none",revision:0,environmentLocked:false};
  await page.route("**/api/studio/capability",r=>r.fulfill({json:{configured:saved,message:saved?"配置存在，待实际使用":"模型尚未连接"}}));
  await page.route("**/api/studio/settings",async r=>{
    if(r.request().method()==="GET") return r.fulfill({json:safe});
    const body=r.request().postDataJSON();expect(body.apiKey).toBe("test-only-connection-secret");expect(body.revision).toBe(0);saved=true;
    return r.fulfill({json:{...safe,...{baseUrl:body.baseUrl,mainModel:body.mainModel,reviewA:body.reviewA,reviewB:body.reviewB,configured:true,hasApiKey:true,source:"local",revision:1}}});
  });
  await page.route(/\/api\/studio\/(analyze|blueprint|review)$/,r=>{calls++;return r.abort();});
  await page.goto("/");await expect(page.getByRole("button",{name:"配置模型",exact:true})).toBeVisible();
  await seedProject(page,"连接验收");await page.getByRole("button",{name:"配置模型",exact:true}).click();
  const dialog=page.getByRole("dialog");await expect(dialog.getByText(/保存仅记录配置/)).toBeVisible();
  await dialog.getByLabel("模型服务地址",{exact:true}).fill("https://example.invalid/v1");
  await dialog.getByLabel("模型API密钥",{exact:true}).fill("test-only-connection-secret");
  await dialog.getByLabel("主模型",{exact:true}).fill("main");await dialog.getByLabel("审查模型 A",{exact:true}).fill("audit-a");await dialog.getByLabel("审查模型 B",{exact:true}).fill("audit-b");
  await dialog.getByRole("button",{name:"保存连接配置"}).click();await expect(dialog.getByText(/配置已保存/)).toBeVisible();await expect(dialog.getByLabel("模型API密钥")).toHaveValue("");
  expect(calls).toBe(0);expect(await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}))).not.toContain("test-only-connection-secret");
  await page.screenshot({path:"test-results/model-connection-desktop.png"});
  await dialog.getByRole("button",{name:"关闭",exact:true}).click();await expect(page.getByText("模型尚未连接",{exact:true})).toHaveCount(0);
});
