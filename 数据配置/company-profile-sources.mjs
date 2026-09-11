/**
 * 公司档案只允许引用本清单中的可追溯公开来源。
 *
 * - government_official：政府机关发布的原文；可信等级 A。
 * - company_official：公司自有域名发布的原文；可信等级 B。
 *
 * 不在此清单中的搜索摘要、商业信息库、媒体转述都不得进入档案。
 */
export const companyProfileSources = [
  {
    id: "suyu-official-terms",
    name: "溯驭技术网站使用条款",
    url: "https://www.seeextech.com/terms.html",
    sourceType: "company_official",
    trustLevel: "B",
  },
  {
    id: "wujiang-scitech-company-profile",
    name: "吴江区科技局企业介绍",
    url: "https://www.wujiang.gov.cn/zgwj/kjcs/202607/00369793751b434c807e6d4fa1d815d5.shtml",
    sourceType: "government_official",
    trustLevel: "A",
  },
];
