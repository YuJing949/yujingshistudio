import React from "react";
import { useLanguage } from "../contexts/LanguageContext";

interface HeaderProps {
  onHomeClick: () => void;
  onProjectsClick: () => void;
  onContactClick: () => void;
  isVisible?: boolean;
}

export function Header({ onHomeClick, onProjectsClick, onContactClick, isVisible = true }: HeaderProps) {
  const { language, setLanguage, t } = useLanguage();

  return (
    <header
      className={`fixed top-0 inset-x-0 w-full z-50 bg-white transition-transform duration-300 ${
        isVisible ? "translate-y-0" : "-translate-y-full"
      }`}
    >
      <nav className="px-3 lg:px-6 py-3.5 lg:py-4 flex items-center justify-between gap-3 lg:gap-4 bg-[#00000000]">
        <div className="flex items-center gap-[14px] lg:gap-12 min-w-0">
          <button
            type="button"
            onClick={onHomeClick}
            className="tracking-wider hover:opacity-60 transition-opacity text-[14px] lg:text-[20px] font-normal whitespace-nowrap"
          >
            {t("nav.home")}
          </button>
          <button
            type="button"
            onClick={onProjectsClick}
            className="tracking-wider hover:opacity-60 transition-opacity text-[14px] lg:text-[20px] font-normal whitespace-nowrap"
          >
            {t("nav.projects")}
          </button>
          <button
            type="button"
            onClick={onContactClick}
            className="tracking-wider hover:opacity-60 transition-opacity text-[14px] lg:text-[20px] font-normal whitespace-nowrap"
          >
            {t("nav.contact")}
          </button>
        </div>

        <div className="flex items-center gap-1.5 lg:gap-2 text-[14px] lg:text-[20px] shrink-0 whitespace-nowrap">
          <button
            type="button"
            onClick={() => setLanguage("en")}
            className={`text-[14px] lg:text-base hover:opacity-60 transition-opacity ${language === "en" ? "font-normal" : "font-light opacity-50"}`}
          >
            ENG
          </button>
          <span className="font-light">|</span>
          <button
            type="button"
            onClick={() => setLanguage("zh")}
            className={`text-[14px] lg:text-base hover:opacity-60 transition-opacity ${language === "zh" ? "font-normal" : "font-light opacity-50"}`}
          >
            中文
          </button>
        </div>
      </nav>
    </header>
  );
}
