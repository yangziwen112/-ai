// 官方来源目录。这里保存公开网页入口，不保存任何第三方密钥。
// 每个来源都绑定业务分组，管理员可以只运行一个分组，避免无差别抓取。
const DEFAULT_SOURCES = [
  {
    id: 'muc-main', name: '中央民族大学',
    listUrl: 'https://www.muc.edu.cn/', baseUrl: 'https://www.muc.edu.cn/',
    linkPattern: /\/info\/\d+\/\d+\.htm$/i, defaultCategory: 'notice', campus: 'all', official: true,
    groups: ['all', 'muc-home'], recencyDays: 7, requireStudentRelevance: true, profile: 'campus-official'
  },
  {
    id: 'muc-jwc', name: '中央民族大学教务处',
    listUrl: 'https://jw.muc.edu.cn/tzgg.htm', baseUrl: 'https://jw.muc.edu.cn/',
    linkPattern: /\/info\/\d+\/\d+\.htm$/i, defaultCategory: 'notice', campus: 'all', official: true,
    groups: ['all', 'muc-home', 'competition'], recencyDays: 7, requireStudentRelevance: true, profile: 'campus-academic'
  },
  {
    id: 'muc-info-engineering', name: '中央民族大学信息工程学院',
    listUrl: 'https://xingong.muc.edu.cn/jyjx/bksjx.htm', baseUrl: 'https://xingong.muc.edu.cn/',
    linkPattern: /\.htm$/i, defaultCategory: 'competition', campus: 'all', official: true,
    groups: ['all', 'info-engineering', 'competition'], recencyDays: 7, requireStudentRelevance: true, profile: 'campus-college'
  },
  {
    id: 'ntce', name: '中国教育考试网·中小学教师资格考试',
    listUrl: 'https://ntce.neea.edu.cn/html1/category/1507/1148-1.htm', baseUrl: 'https://ntce.neea.edu.cn/',
    linkPattern: /\/html1\/report\/\d+\/\d+-1\.htm$/i, defaultCategory: 'certification', campus: 'all', official: true,
    groups: ['all', 'teacher-cert', 'certification'], recencyDays: 60, requireStudentRelevance: true, profile: 'teacher-cert'
  },
  {
    id: 'graduate-admission', name: '中国研究生招生信息网',
    listUrl: 'https://yz.chsi.com.cn/', baseUrl: 'https://yz.chsi.com.cn/',
    linkPattern: /\/(kyzx|sch|zsml|tm|sx)/i, defaultCategory: 'certification', campus: 'all', official: true,
    groups: ['all', 'graduate-exam', 'certification'], recencyDays: 30, requireStudentRelevance: true, profile: 'graduate-admission'
  },
  {
    id: 'cet', name: '全国大学英语四、六级考试',
    listUrl: 'https://cet.neea.edu.cn/', baseUrl: 'https://cet.neea.edu.cn/',
    linkPattern: /\/(html1|news|content|report)\//i, defaultCategory: 'certification', campus: 'all', official: true,
    groups: ['all', 'certification', 'exam'], recencyDays: 60, requireStudentRelevance: true, profile: 'language-exam'
  },
  {
    id: 'three-innovation', name: '全国大学生电子商务“创新、创意及创业”挑战赛',
    listUrl: 'https://www.3chuang.net/', baseUrl: 'https://www.3chuang.net/',
    linkPattern: /\/(news|notice|article|competition|match|html|detail)/i, defaultCategory: 'competition', campus: 'all', official: true,
    groups: ['all', 'competition', 'three-innovation'], recencyDays: 30, requireStudentRelevance: true, profile: 'three-innovation'
  },
  {
    id: 'innovation-china', name: '中国国际大学生创新大赛',
    listUrl: 'https://cy.ncss.cn/', baseUrl: 'https://cy.ncss.cn/',
    linkPattern: /\/(news|notice|match|competition|article|detail)/i, defaultCategory: 'competition', campus: 'all', official: true,
    groups: ['all', 'competition', 'innovation-entrepreneurship'], recencyDays: 30, requireStudentRelevance: true, profile: 'innovation-entrepreneurship'
  },
  {
    id: 'challenge-cup', name: '挑战杯全国大学生课外学术科技作品竞赛',
    listUrl: 'https://www.tiaozhanbei.net/', baseUrl: 'https://www.tiaozhanbei.net/',
    linkPattern: /\/(news|notice|match|competition|article|detail)/i, defaultCategory: 'competition', campus: 'all', official: true,
    groups: ['all', 'competition', 'challenge-cup'], recencyDays: 30, requireStudentRelevance: true, profile: 'challenge-cup'
  },
  {
    id: 'ncss-career', name: '国家大学生就业服务平台',
    listUrl: 'https://job.ncss.cn/', baseUrl: 'https://job.ncss.cn/',
    linkPattern: /\/(notice|news|job|article|detail)/i, defaultCategory: 'recruit', campus: 'all', official: true,
    groups: ['all', 'career'], recencyDays: 14, requireStudentRelevance: true, profile: 'career'
  }
]

module.exports = { DEFAULT_SOURCES }
