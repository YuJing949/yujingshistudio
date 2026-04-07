import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Header } from "./Header";
import { ImageWithLoading, VideoWithLoading } from "./MediaWithLoading";
import { useLanguage } from "../contexts/LanguageContext";

const projectThumbnails: Record<number, { thumbnail: string; video?: string }> = {
  1: {
    thumbnail: "https://media.yujingshistudio.com/plant_stick.mp4",
    video: "https://media.yujingshistudio.com/plant_stick.mp4",
  },
  2: {
    thumbnail: "https://media.yujingshistudio.com/tala_home.mp4",
    video: "https://media.yujingshistudio.com/tala_home.mp4",
  },
  3: {
    thumbnail: "https://media.yujingshistudio.com/stockwell_render2.jpg",
  },
  4: {
    thumbnail: "https://media.yujingshistudio.com/time_rotate.mp4",
  },
};

export function Home() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { t } = useLanguage();
  const introRef = useRef<HTMLDivElement>(null);
  const projectsRef = useRef<HTMLDivElement>(null);
  const contactRef = useRef<HTMLDivElement>(null);
  const rightColumnRef = useRef<HTMLDivElement>(null);
  const leftColumnRef = useRef<HTMLDivElement>(null);
  const [cursorPosition, setCursorPosition] = useState({ x: 0, y: 0 });
  const [showCursor, setShowCursor] = useState(false);
  const [isLeftColumnHovered, setIsLeftColumnHovered] = useState(false);
  const [isRightColumnHovered, setIsRightColumnHovered] = useState(false);

  const projects = [1, 2, 3, 4].map((id) => ({
    id,
    title: t(`project.${id}.title`),
    subtitle: t(`project.${id}.subtitle`),
    ...projectThumbnails[id],
  }));

  const scrollToTop = () => {
    rightColumnRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const scrollToProjects = () => {
    projectsRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const scrollToContact = () => {
    contactRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    setCursorPosition({ x: e.clientX, y: e.clientY });
  };

  const handleMouseEnter = () => {
    setShowCursor(true);
  };

  const handleMouseLeave = () => {
    setShowCursor(false);
  };

  const handleRightColumnMouseEnter = () => setIsRightColumnHovered(true);
  const handleRightColumnMouseLeave = () => setIsRightColumnHovered(false);
  const handleLeftColumnMouseEnter = () => setIsLeftColumnHovered(true);
  const handleLeftColumnMouseLeave = () => setIsLeftColumnHovered(false);
  const handleRightColumnMouseMove = (e: React.MouseEvent) => {
    setCursorPosition({ x: e.clientX, y: e.clientY });
  };

  // 从项目页返回时 ?section=projects|contact 滚动到对应区块
  useEffect(() => {
    const section = searchParams.get("section");
    if (section !== "projects" && section !== "contact") return;
    const timer = window.setTimeout(() => {
      if (section === "projects") projectsRef.current?.scrollIntoView({ behavior: "smooth" });
      else contactRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 100);
    return () => window.clearTimeout(timer);
  }, [searchParams]);

  // 左栏滚轮时滚动右栏（仅桌面端），与右栏原生滚动手感一致
  useEffect(() => {
    const el = leftColumnRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      if (window.innerWidth < 1024 || !rightColumnRef.current) return;
      e.preventDefault();
      const container = rightColumnRef.current;
      let delta = 0;
      if (e.deltaMode === 0) {
        delta = e.deltaY;
      } else if (e.deltaMode === 1) {
        delta = e.deltaY * 40;
      } else {
        delta = e.deltaY * container.clientHeight;
      }
      container.scrollTop += delta;
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  return (
    <div className="min-h-screen bg-white overflow-hidden">
      <Header
        onHomeClick={scrollToTop}
        onProjectsClick={scrollToProjects}
        onContactClick={scrollToContact}
      />

      {showCursor && (
        <div
          className="fixed pointer-events-none z-50 text-white text-xl tracking-wider hidden lg:block"
          style={{
            left: `${cursorPosition.x}px`,
            top: `${cursorPosition.y}px`,
            transform: "translate(-50%, -50%)",
          }}
        >
          enter
        </div>
      )}

      {(isLeftColumnHovered || isRightColumnHovered) && !showCursor && (
        <div
          className="fixed pointer-events-none z-50 text-gray-400 text-xl tracking-wider hidden lg:block"
          style={{
            left: `${cursorPosition.x}px`,
            top: `${cursorPosition.y}px`,
            transform: "translate(-50%, -50%)",
          }}
        >
          scroll
        </div>
      )}

      <div className="flex flex-col lg:flex-row lg:h-screen">
        <div
          ref={leftColumnRef}
          className="w-full lg:w-1/2 flex items-start px-3 pt-20 pb-8 lg:pb-0 lg:fixed lg:h-screen"
          onMouseMove={handleRightColumnMouseMove}
          onMouseEnter={handleLeftColumnMouseEnter}
          onMouseLeave={handleLeftColumnMouseLeave}
        >
          <h1 className="font-bold leading-none tracking-tight text-[clamp(2.5rem,10vw,12.5rem)] [word-break:keep-all]">
            {t("intro.greeting.line1")},<br />
            <span className="whitespace-nowrap">{t("intro.greeting.line2")},</span>
          </h1>
        </div>

        <div
          ref={rightColumnRef}
          className="w-full lg:w-1/2 lg:ml-[50%] lg:overflow-y-auto"
          style={{ scrollBehavior: "smooth" }}
          onMouseMove={handleRightColumnMouseMove}
          onMouseEnter={handleRightColumnMouseEnter}
          onMouseLeave={handleRightColumnMouseLeave}
        >
          <div ref={introRef} className="lg:min-h-screen flex items-start lg:items-end px-3 pb-8">
            <p className="text-lg lg:text-2xl leading-relaxed font-light">{t("intro.description")}</p>
          </div>

          <div ref={projectsRef} data-section="projects" className="min-h-screen py-8 px-3">
            <h2 className="tracking-tight mb-8 text-[28px] lg:text-[36px] italic font-bold">{t("projects.title")}</h2>
            <div className="space-y-6">
              {projects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => navigate(`/project/${project.id}`)}
                  onMouseMove={handleMouseMove}
                  onMouseEnter={handleMouseEnter}
                  onMouseLeave={handleMouseLeave}
                  className="block w-full group lg:cursor-none"
                >
                  <div className="aspect-[4/3] overflow-hidden relative">
                    {project.thumbnail.endsWith(".mp4") ? (
                      <VideoWithLoading
                        src={project.thumbnail}
                        loop
                        muted
                        playsInline
                        onMouseEnter={(e) => e.currentTarget.play()}
                        onMouseLeave={(e) => e.currentTarget.pause()}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    ) : (
                      <ImageWithLoading
                        src={project.thumbnail}
                        alt={project.title}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    )}
                  </div>
                  <p className="mt-2 text-sm tracking-wider text-left">{project.subtitle}</p>
                </button>
              ))}
            </div>
          </div>

          <div ref={contactRef} data-section="contact" className="min-h-screen py-8 px-3">
            <div className="flex flex-col lg:flex-row gap-8">
              <div className="flex-1">
                <h2 className="text-[28px] lg:text-[36px] tracking-tight mb-8 font-bold">{t("contact.title")}</h2>
                <div className="space-y-4">
                  <div>
                    <p className="text-lg lg:text-xl text-gray-500 mb-2">{t("contact.instagram")}</p>
                    <a
                      href="https://instagram.com/yujing.context"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-lg lg:text-xl hover:opacity-60 transition-opacity"
                    >
                      @yujing.context
                    </a>
                  </div>
                  <div>
                    <p className="text-lg lg:text-xl text-gray-500 mb-2">{t("contact.behance")}</p>
                    <a
                      href="https://behance.net/yujingshi4"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-lg lg:text-xl hover:opacity-60 transition-opacity"
                    >
                      behance.net/yujingshi4
                    </a>
                  </div>
                  <div>
                    <p className="text-lg lg:text-xl text-gray-500 mb-2">{t("contact.linkedin")}</p>
                    <a
                      href="https://linkedin.com/in/yujingshi6"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-lg lg:text-xl hover:opacity-60 transition-opacity"
                    >
                      linkedin.com/in/yujingshi6
                    </a>
                  </div>
                  <div>
                    <p className="text-lg lg:text-xl text-gray-500 mb-2">{t("contact.email")}</p>
                    <a
                      href="mailto:shi.yujing@outlook.com"
                      className="block text-lg lg:text-xl hover:opacity-60 transition-opacity"
                    >
                      shi.yujing@outlook.com
                    </a>
                  </div>
                </div>
              </div>

              <div className="flex-1">
                <div className="aspect-[3/4] overflow-hidden relative">
                  <ImageWithLoading
                    src="https://media.yujingshistudio.com/me.jpg"
                    alt="Yujing Shi"
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
