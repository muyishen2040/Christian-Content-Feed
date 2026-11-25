"""Topic vocabulary for testimonies (MUY-17). Data only: change it through a reviewed PR.

PROPOSED, not final: the vocabulary is the people's call. Slugs are the stable identifiers stored in
`testimonies.topics` (and later reused to relate testimonies to sermons). Labels are for display.
Keywords are matched against the cleaned title only (we hold no article text), in Traditional and
Simplified forms. A title that matches nothing stays untagged; that is a valid outcome and is never
guessed.
"""

from __future__ import annotations

# slug: (label_zh_hant, label_zh_hans, keywords)
TAXONOMY: dict[str, tuple[str, str, tuple[str, ...]]] = {
    "healing": ("醫治與健康", "医治与健康", ("醫治", "医治", "病", "癌", "康復", "康复", "痊癒", "痊愈", "手術", "手术", "住院")),
    "family": ("家庭與婚姻", "家庭与婚姻", ("家庭", "婚姻", "夫妻", "丈夫", "太太", "妻子", "父母", "母親", "母亲", "父親", "父亲", "兒女", "儿女", "孩子", "親子", "亲子", "前夫", "離婚", "离婚")),
    "youth": ("青少年與成長", "青少年与成长", ("青少年", "青年", "學生", "学生", "校園", "校园", "大專", "大专", "成長", "成长", "叛逆")),
    "provision": ("供應與工作", "供应与工作", ("供應", "供应", "工作", "職場", "职场", "失業", "失业", "經濟", "经济", "財務", "财务", "金錢", "金钱", "奉獻", "奉献")),
    "peace_anxiety": ("平安與焦慮", "平安与焦虑", ("平安", "焦慮", "焦虑", "恐懼", "恐惧", "憂慮", "忧虑", "壓力", "压力", "安息", "喜樂", "喜乐")),
    "grief_comfort": ("安慰與失落", "安慰与失落", ("安慰", "失去", "離世", "离世", "喪", "丧", "哀傷", "哀伤", "悲傷", "悲伤", "思念")),
    "forgiveness": ("饒恕與和好", "饶恕与和好", ("饒恕", "饶恕", "寬恕", "宽恕", "原諒", "原谅", "和好", "苦毒", "放下", "恢復關係", "恢复关系")),
    "conversion": ("信主與歸向", "信主与归向", ("信主", "決志", "决志", "歸主", "归主", "重生", "福音", "悔改", "浪子", "第二個生日", "第二个生日", "蒙恩得救")),
    "faith_trial": ("信心與試煉", "信心与试炼", ("信心", "試煉", "试炼", "患難", "患难", "困境", "苦難", "苦难", "軟弱", "软弱", "跌倒", "掙扎", "挣扎")),
    "prayer_guidance": ("禱告與引導", "祷告与引导", ("禱告", "祷告", "引導", "引导", "帶領", "带领", "呼召", "感動", "感动", "聽見", "听见", "神的旨意")),
    "addiction_freedom": ("釋放與勝過", "释放与胜过", ("釋放", "释放", "癮", "瘾", "網路成癮", "賭", "赌", "酒", "捆綁", "捆绑", "勝過", "胜过", "咒詛", "咒诅")),
    "mission_service": ("事奉與宣教", "事奉与宣教", ("事奉", "宣教", "傳道", "传道", "服事", "服事", "短宣", "差傳", "差传", "牧者", "團契", "团契")),
    "gratitude_grace": ("感恩與恩典", "感恩与恩典", ("感恩", "恩典", "感謝", "感谢", "蒙福", "祝福", "同在", "信實", "信实")),
}

UNTAGGED = "untagged"  # an outcome, not a stored topic value


def labels(slug: str) -> tuple[str, str]:
    hant, hans, _ = TAXONOMY[slug]
    return hant, hans
