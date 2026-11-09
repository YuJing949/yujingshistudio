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
      "I’m a product and experience designer exploring embodied and playful interaction, working at the intersection of product design, computing and spatial experience. I’m currently studying Innovation Design Engineering, a joint programme between the Royal College of Art and Imperial College London, and hold a BA in Product and Furniture Design from UAL.",

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
      "The Orbital Hour invites users to measure time in personal memories instead of minutes. Through a system of time specimen boxes and a rotating timer device, time becomes not just something to count, but something to feel and treasure, reconnecting time with lived experience.",
    "project.4.extra":
      "Each memory (such as a leaf) is sealed into an NFC-tagged “record” and linked to a duration. Place it on the player and lower the tone arm, and an LED travels one full orbit. When idle, the device works as a blurred clock.",
    "project.3.extra":
      "Stockwell’s new art centre needed space for wet paper and fabric artwork, usable by residents of all ages and abilities. This project ran co-design workshops linking the client, the architect and local residents to gather ongoing feedback.",
    "project.1.keywords": "Sustainable design, community living",
    "project.2.keywords": "Lighting design, product design",
    "project.3.keywords": "Participatory design, community service",
    "project.4.keywords": "Interaction design, product design",

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
      "我是一名产品与体验设计师，致力于探索具身化与趣味性的交互设计，工作领域涵盖产品设计、计算科学与空间体验的交叉地带。现就读于英国皇家艺术学院与帝国理工学院联合开设的创新设计工程专业，并持有伦敦艺术大学产品与家具设计学士学位。",

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
      "轨道时间邀请用户以个人记忆而非分钟来度量时间。通过一套时间标本盒系统和一个旋转计时装置，时间不再只是被计算的数字，而成为可以被感知、被珍藏的体验，从而将时间与真实的生活经历重新连接。",
    "project.4.extra":
      "每一段记忆（比如一片树叶）都被封存进一张带 NFC 标签的“唱片”，并与一段时长相连。把它放上播放器、放下唱臂，一颗 LED 便沿轨道走完一整圈。闲置时，这个装置是一只模糊的时钟。",
    "project.3.extra":
      "Stockwell 新艺术中心需要一个晾放湿纸与织物作品的空间，并让不同年龄、不同能力的居民都能使用。本项目组织了共同设计工作坊，连接委托方、建筑师与当地居民，持续收集反馈。",
    "project.1.keywords": "可持续设计，社区生活",
    "project.2.keywords": "灯光设计，产品设计",
    "project.3.keywords": "参与式设计，社区服务",
    "project.4.keywords": "交互设计，产品设计",

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
