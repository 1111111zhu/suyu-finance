// Official document discovery seeds, not verified eligibility. Kept on every run.
// Annual/expired/basis documents stay in the audit and point to recurring programs.
export const policyWatchlist = [
  ['watch-hz-service-voucher','杭州市中小微企业服务券管理办法','杭州市','https://zfgb.hangzhou.gov.cn/11/106220263/t104220263064/530486.shtml','2026-04-13'],
  ['watch-sme-interest-update','关于进一步做好财政金融协同促内需政策有关工作的通知','国家','https://jrs.mof.gov.cn/zhengcefabu/phjr/202608/t20260820_3995853.htm','2026-08-17'],
  ['watch-equipment-interest','关于优化实施设备更新贷款财政贴息政策的通知','国家','https://m.mof.gov.cn/czxw/202601/t20260119_3982162.htm','2026-01-19'],
  ['watch-hz-ip-2026','关于发布2026年杭州市知识产权项目申报指南的通知','杭州市','https://scjg.hangzhou.gov.cn/col/col1693484/art/2026/art_0aeb44b1701748cab5272cd55a9e9df6.html','2026-08-18'],
  ['watch-wj-tech-2026','2026年苏州市“科创指数惠”政策兑现工作开始啦','苏州市','https://www.wujiang.gov.cn/zgwj/kjcs/202603/d41fd5c74dca443aa5230e5afa0c287d.shtml','2026-03-27'],
  ['watch-lyg-manufacturing','关于组织申报2025年度市级制造强市专项资金的通知','连云港市','http://gxj.lyg.gov.cn/lygsjjhxxhwyh/tztg/content/a7c06737-5047-473e-a19f-77319ff0c8eb.html','2026-04-23'],
].map(([id,title,region,url,publishDate]) => ({id,title,region,url,publishDate,sourceId:'funding-watchlist',sourceName:'资金漏项持续核查入口',category:'资金线索',summary:'仅为持续发现入口，须核实当期申报、原文关联及申请角色。',discoveryOnly:true}));

export const additionalFundingSources = [
  {id:'mof-finance',name:'财政部金融司政策发布',region:'国家',url:'https://jrs.mof.gov.cn/zhengcefabu/phjr/'},
  {id:'hangzhou-miit',name:'杭州市经信局通知公告',region:'杭州市',url:'https://jxj.hangzhou.gov.cn/col/col1229252271/index.html'},
  {id:'hangzhou-market',name:'杭州市市场监管局知识产权通知',region:'杭州市',url:'https://scjg.hangzhou.gov.cn/col/col1693484/index.html'},
  {id:'lianyungang-miit',name:'连云港市工信局通知公告',region:'连云港市',url:'http://gxj.lyg.gov.cn/lygsjjhxxhwyh/tztg/tztg.html'},
  {id:'ganyu-funding',name:'赣榆区政府公告（属地待核）',region:'连云港市',url:'https://www.ganyu.gov.cn/gyqzf/gsgg/gsgg.html'},
];
