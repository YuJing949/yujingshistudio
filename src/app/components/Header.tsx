import React from "react";

interface HeaderProps {
  onHomeClick: () => void;
  onProjectsClick: () => void;
  onContactClick: () => void;
  isVisible?: boolean;
}

export function Header({ onHomeClick, onProjectsClick, onContactClick, isVisible = true }: HeaderProps) {
  return (
    <header 
      className={`fixed top-0 left-0 w-full lg:w-1/2 z-50 bg-white transition-transform duration-300 ${
        isVisible ? 'translate-y-0' : '-translate-y-full'
      }`}
    >
      <nav className="px-4 lg:px-6 py-4 flex items-center gap-6 lg:gap-12 bg-[#00000000]">
        <button
          onClick={onHomeClick}
          className="tracking-wider hover:opacity-60 transition-opacity text-base lg:text-[20px] font-normal"
        >
          Yujing Shi
        </button>
        <button
          onClick={onProjectsClick}
          className="tracking-wider hover:opacity-60 transition-opacity text-base lg:text-[20px] font-normal"
        >
          Projects
        </button>
        <button
          onClick={onContactClick}
          className="tracking-wider hover:opacity-60 transition-opacity text-base lg:text-[20px] font-normal"
        >
          Contact
        </button>
      </nav>
    </header>
  );
}