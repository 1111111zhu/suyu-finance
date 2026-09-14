/**
 * 人工确认的申报主体与申报方向。
 *
 * 这不是工商档案，也不声称主体已经满足任何认定条件：它只说明项目
 * 应该分配给哪个业务主体。法律全称、统一社会信用代码和注册地仍必须
 * 由公司档案的公开来源按月核验，未知值不能在这里补猜。
 */
export const applicationEntities = [
  {
    id: "hangzhou-suyu",
    label: "杭州溯驭",
    status: "user_confirmed",
    confirmedAt: "2026-09-03",
    allowedRegions: ["国家", "浙江省", "杭州市"],
    scopes: [
      {
        id: "high-tech-enterprise",
        label: "高新技术企业认定",
        policyTerms: ["高新技术企业", "国家高新技术企业", "高企认定"],
      },
    ],
  },
  {
    id: "suzhou-suyu",
    label: "苏州溯驭",
    status: "user_confirmed",
    confirmedAt: "2026-09-03",
    allowedRegions: ["国家", "江苏省", "苏州市"],
    scopes: [
      {
        id: "specialized-little-giant",
        label: "专精特新“小巨人”认定",
        policyTerms: ["专精特新“小巨人”", "专精特新\"小巨人\"", "专精特新小巨人", "小巨人企业"],
      },
    ],
  },
];

export const applicationScopeDefinitions = [
  {
    id: "high-tech-enterprise",
    label: "高新技术企业认定",
    terms: ["高新技术企业", "国家高新技术企业", "高企认定"],
  },
  {
    id: "specialized-little-giant",
    label: "专精特新“小巨人”认定",
    terms: ["专精特新“小巨人”", "专精特新\"小巨人\"", "专精特新小巨人", "小巨人企业"],
  },
];
