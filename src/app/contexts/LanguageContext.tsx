import React, { createContext, useContext, useState, ReactNode } from "react";

type Language = "en" | "zh";

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const translations = {
  en: {
    // Navigation
    "nav.home": "YUJING SHI",
    "nav.projects": "PROJECTS",
    "nav.contact": "CONTACT",

    // Intro
    "intro.greeting.line1": "Hi, I'm",
    "intro.greeting.line2": "Yujing Shi",
    "intro.description":
      "I'm a product and experience designer exploring embodied and inclusive interaction. Based in London, working at the intersection of object-making, computing, and spatial curation. Currently studying Product & Furniture Design at UAL, with a Creative Computing diploma from CCI.",

    // Projects
    "projects.title": "PROJECTS",
    "project.1.title": "Grow-Together",
    "project.1.subtitle": "A Modular Herb Pot Reducing Waste and Encouraging Community Sharing.",
    "project.1.description":
      "Excess food waste is a big challenge for everyone who lives alone. At the same time, for students living in an international student accommodation, trying to connect with flatmates from diverse cultures is essential and challenging. This project explores growing herbs can foster a more sustainable and socially connected community. The final design is a modular self-sustaining herb pot, encouraging students to reduce waste and strengthen the bonds through growing, maintaining, and sharing herbs.",
    "project.2.title": "A Traveller's Living Room",
    "project.2.subtitle": "A Lighting Support Exploring the Boundary Between Home and Public Space.",
    "project.2.description":
      'Responding to an invitation from lighting brand Tala, this project introduces a portable support designed for spaces where permanent fixtures are impossible. Tailored for the nomadic urbanite, it carries the warmth and controllability of domestic light into the public realm. By recreating an intimate atmosphere wherever it goes, the project explores and expands the boundaries of home.',
    "project.3.title": "Co-designed Furniture with Stockwell Community",
    "project.3.subtitle": "Co-designed Furniture with Stockwell Community.",
    "project.3.description":
      "Commissioned by Stockwell Trust, this project designs furniture for Stockwell's new art centre through a series of co-design workshops with local residents. A drying and displaying shelf is made to empower the creatives of different abilities. Responding to both physical and emotional needs, this shelf allows every artwork to be seen in its necessary drying process, making every printing and painting session a temporary exhibition.",
    "project.4.title": "Orbital Time",
    "project.4.subtitle": "A Timer That Empowers Users to Redefine Time in Their Own Ways.",
    "project.4.description":
      "The Orbital Hour invites users to define their own rhythms by turning objects and memories into personal measures of time. Through a system of time specimen boxes and a rotating timer device, time becomes not just something to count, but something to feel and treasure, reconnecting time with lived experience.",

    // Contact
    "contact.title": "CONTACT",
    "contact.email": "Email",
    "contact.instagram": "Instagram",
    "contact.behance": "Behance",
    "contact.linkedin": "LinkedIn",
  },
  zh: {
    // Navigation
    "nav.home": "石宇静",
    "nav.projects": "项目",
    "nav.contact": "联系方式",

    // Intro
    "intro.greeting.line1": "你好",
    "intro.greeting.line2": "我是石宇静",
    "intro.description":
      "我致力于探索具身化与包容性的交互设计。目前常驻伦敦,工作领域涵盖物件制造、计算科学及空间策划的交叉地带。现就读于伦敦艺术大学产品与家具设计专业，同时持有创意计算学院的创意计算文凭。",

    // Projects
    "projects.title": "过往项目",
    "project.1.title": "Grow-Together",
    "project.1.subtitle": "一款减少浪费并鼓励社区分享的模块化香草种植盆。",
    "project.1.description":
      "食物浪费是独居群体面临的一大挑战。与此同时，对于住在国际公寓的学生来说，与文化背景多元的室友建立联系既重要又充满挑战。本项目探索了种植香草如何促进社区的可持续性与社交连接。最终设计是一款模块化的自循环香草种植盆，鼓励学生通过种植、维护和分享香草来减少浪费并加强情感纽带。",
    "project.2.title": "旅人的客厅",
    "project.2.subtitle": "一款探索家与公共空间边界的照明支撑。",
    "project.2.description":
      '应灯具品牌 Tala 的邀请，本项目设计了一款针对无法安装固定装置的空间而设计的便携式支撑结构。该设计专为"城市游牧者"量身定制，将居家灯光的温暖感与可控性带入公共场域。通过在公共空间使用Tala灯光重塑流动的氛围，本项目探索并拓展了"家"的边界。',
    "project.3.title": "与Stockwell社区共同设计家具",
    "project.3.subtitle": "与 Stockwell 社区共同设计的系列家具。",
    "project.3.description":
      '受 Stockwell Trust 委托，本项目通过与当地居民的一系列"共同设计（Co-design）"工作坊，为 Stockwell 新成立的艺术中心设计家具。这款晾晒展示架旨在赋能不同能力的创作者。针对生理与情感的双重需求，该架子让每件作品在必要的晾干过程中都能被看见，使每一次印刷和绘画课都变成一场临时的展览。',
    "project.4.title": "轨道时间",
    "project.4.subtitle": "一款赋予用户权利、以个人方式重新定义时间的计时器。",
    "project.4.description":
      "轨道时间邀请用户通过将物件与记忆转化为个人度量时间的方式，来定义属于自己的时间节奏。通过一套时间标本盒系统和一个旋转计时装置，时间不再仅仅是冰冷的数字计算，而变成了可以被感知、被珍藏的体验，从而将时间与真实的生活经历重新连接。",

    // Contact
    "contact.title": "联系方式",
    "contact.email": "电子邮箱",
    "contact.instagram": "Instagram",
    "contact.behance": "Behance",
    "contact.linkedin": "LinkedIn",
  },
};

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>("en");

  const t = (key: string): string => {
    return translations[language][key as keyof (typeof translations)["en"]] || key;
  };

  return <LanguageContext.Provider value={{ language, setLanguage, t }}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return context;
}
