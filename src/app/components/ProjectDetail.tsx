import React, { ReactNode, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router";
import { Header } from "./Header";
import { ImageWithLoading, VideoWithLoading } from "./MediaWithLoading";
import { useLanguage } from "../contexts/LanguageContext";

const MEDIA = "https://media.yujingshistudio.com";

// 项目在页面上的顺序（和首页一致）
const PROJECT_ORDER = ["4", "3", "1", "2"];

// 排版：电脑上是两栏（标题在左、介绍在右；图片两栏，大小不必一样），手机上变成一栏，
// 只有纯图片的网格在手机上仍保持两栏。
const twoCol = "grid grid-cols-1 lg:grid-cols-2 lg:gap-x-10";
const bodyText = "text-base leading-[1.55] lg:text-xl lg:leading-normal";
const imgFull = "w-full h-auto block";

// place: 这张图在网格里的位置（加在外层，网格才认得到）
function Img({ src, alt, className = imgFull, place = "" }: { src: string; alt: string; className?: string; place?: string }) {
  return (
    <div className={place}>
      <ImageWithLoading src={src} alt={alt} fillHeight={false} className={className} />
    </div>
  );
}

function Clip({ src, className = imgFull, place = "" }: { src: string; className?: string; place?: string }) {
  return (
    <div className={place}>
      <VideoWithLoading src={src} fillHeight={false} className={className} loop muted autoPlay playsInline />
    </div>
  );
}

function ProjectHeader({ id }: { id: string }) {
  const { t } = useLanguage();
  return (
    <div className={`${twoCol} gap-y-6 mb-8 lg:mb-20`}>
      <h1 className="font-bold tracking-tight leading-[1.05] text-[36px] lg:text-[clamp(2rem,5vw,4.5rem)]">
        {t(`project.${id}.title`)}
      </h1>
      <div className="flex flex-col gap-6">
        <p className={bodyText}>{t(`project.${id}.description`)}</p>
        <p className="text-base leading-snug font-bold">{t(`project.${id}.keywords`)}</p>
      </div>
    </div>
  );
}

function GrowTogether() {
  const { t } = useLanguage();
  const title = t("project.1.title");
  return (
    <>
      <Img src={`${MEDIA}/plant_KITCHEN.png`} alt={`${title} - 1`} />
      <div className={`${twoCol} gap-y-3 lg:gap-y-5`}>
        <Img
          src={`${MEDIA}/plant_model1.png`}
          alt={`${title} - 2`}
          className="w-full aspect-[4/3] object-cover block" place="lg:col-start-1 lg:row-start-1"
        />
        <Img
          src={`${MEDIA}/plant_model2.png`}
          alt={`${title} - 3`}
          className="w-full aspect-[4/3] object-cover block" place="lg:col-start-1 lg:row-start-2"
        />
        <p className={`${bodyText} lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:self-center lg:max-w-[34em]`}>
          {t("project.1.extra")}
        </p>
      </div>
      <Img src={`${MEDIA}/plant_render.png`} alt={`${title} - 4`} className="w-full aspect-[4/3] object-cover block" />
    </>
  );
}

function Stockwell() {
  const { t } = useLanguage();
  const title = t("project.3.title");
  const portraits = ["stockwell_workshop.jpg", "stockwell_model.jpg", "stockwell_detail.jpg", "stockwell_play.jpg"];
  return (
    <>
      <Img src={`${MEDIA}/stockwell_render.png`} alt={`${title} - 1`} />
      <div className={`${twoCol} py-6 lg:py-[60px]`}>
        <p className={`${bodyText} lg:max-w-[34em]`}>{t("project.3.extra")}</p>
      </div>
      <div className="grid grid-cols-2 gap-2 lg:gap-5">
        {portraits.map((file, i) => (
          <Img key={file} src={`${MEDIA}/${file}`} alt={`${title} - ${i + 2}`} className="w-full aspect-[3/4] object-cover block" />
        ))}
      </div>
    </>
  );
}

function OrbitalTime() {
  const { t } = useLanguage();
  const title = t("project.4.title");
  return (
    <>
      <Clip src={`${MEDIA}/time_box.mp4`} />
      <div className={`${twoCol} gap-y-3 lg:gap-y-5`}>
        <Img
          src={`${MEDIA}/time_detail.jpg`}
          alt={`${title} - detail`}
          className="w-full aspect-[4/3] object-cover block" place="lg:self-start"
        />
        <Img
          src={`${MEDIA}/time_model.png`}
          alt={`${title} - model`}
          className="w-full aspect-[4/5] object-cover object-[46%_50%] block"
        />
        <Clip src={`${MEDIA}/time_rotate.mp4`} className="w-full aspect-[4/3] object-cover block" place="lg:col-start-2 lg:row-start-2" />
        <p className={`${bodyText} lg:col-start-1 lg:row-start-2 lg:self-start lg:max-w-[34em]`}>
          {t("project.4.extra")}
        </p>
      </div>
      <Img src="/images/orbital-exploded.webp" alt={`${title} - exploded view with parts and materials`} place="mt-6 lg:mt-[60px]" />
    </>
  );
}

function TravellersLivingRoom() {
  const { t } = useLanguage();
  const title = t("project.2.title");
  const images = ["tala_umbre.png", "tala_3types.png", "tala_station.png", "tala_train.png"];
  return (
    <>
      <div className="relative w-full" style={{ paddingBottom: "56.25%" }}>
        <iframe
          src="https://www.youtube.com/embed/PZZ7LRT83KU?si=bf_5wOSnnhTMkoSh&start=1"
          title="YouTube video player"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          className="absolute top-0 left-0 w-full h-full"
          style={{ border: 0 }}
        />
      </div>
      <div className="grid grid-cols-2 gap-2 lg:gap-5">
        {images.map((file, i) => (
          <Img key={file} src={`${MEDIA}/${file}`} alt={`${title} - ${i + 1}`} className="w-full aspect-[4/3] object-cover block" />
        ))}
      </div>
    </>
  );
}

const PROJECT_BODY: Record<string, () => ReactNode> = {
  "1": () => <GrowTogether />,
  "2": () => <TravellersLivingRoom />,
  "3": () => <Stockwell />,
  "4": () => <OrbitalTime />,
};

function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [showBack, setShowBack] = useState(false);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [headerVisible, setHeaderVisible] = useState(true);
  const [, setLastScrollY] = useState(0);

  const handleNavigation = (section?: string) => {
    if (section) {
      navigate(`/?section=${section}`);
    } else {
      navigate("/");
    }
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({ x: e.clientX, y: e.clientY });
      setShowBack(e.clientX < window.innerWidth / 5);
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      setLastScrollY((prevScrollY) => {
        if (currentScrollY > prevScrollY && currentScrollY > 50) {
          setHeaderVisible(false);
        } else if (currentScrollY < prevScrollY) {
          setHeaderVisible(true);
        }
        return currentScrollY;
      });
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // 打开某个项目时滚到它。上面项目的图片陆续加载会把它往下推，
  // 所以在所有图片加载完之前（最多 10 秒），每当高度变了就再对齐一次；用户自己一滚动就停止。
  useEffect(() => {
    if (!id) return;
    const element = document.querySelector(`[data-project-id="${id}"]`);
    if (!element) return;
    let stopped = false;
    const stop = () => {
      stopped = true;
    };
    const align = () => {
      if (!stopped) element.scrollIntoView({ behavior: "auto" });
    };
    const first = window.setTimeout(align, 100);
    const observer = new ResizeObserver(align);
    observer.observe(document.body);
    const finish = () => {
      align();
      stop();
      observer.disconnect();
      window.clearInterval(check);
    };
    const end = window.setTimeout(finish, 10000);
    // 所有图片都加载完、并稳定一会儿后结束
    let settled = 0;
    const check = window.setInterval(() => {
      const imgs = Array.from(document.querySelectorAll<HTMLImageElement>("main img"));
      const videos = Array.from(document.querySelectorAll<HTMLVideoElement>("main video"));
      const ready = imgs.every((img) => img.complete) && videos.every((v) => v.readyState >= 1);
      settled = ready ? settled + 1 : 0;
      if (settled >= 2) finish();
    }, 400);
    window.addEventListener("wheel", stop, { passive: true });
    window.addEventListener("touchstart", stop, { passive: true });
    window.addEventListener("keydown", stop);
    return () => {
      stop();
      observer.disconnect();
      window.clearTimeout(first);
      window.clearTimeout(end);
      window.clearInterval(check);
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchstart", stop);
      window.removeEventListener("keydown", stop);
    };
  }, [id]);

  return (
    <div className="min-h-screen bg-white">
      <Header
        onHomeClick={() => handleNavigation()}
        onProjectsClick={() => handleNavigation("projects")}
        onContactClick={() => handleNavigation("contact")}
        isVisible={headerVisible}
      />

      {showBack && (
        <div
          className="fixed z-50 cursor-pointer text-white text-xl hidden lg:block"
          style={{
            left: `${mousePosition.x}px`,
            top: `${mousePosition.y}px`,
            transform: "translate(-50%, -50%)",
          }}
          onClick={() => handleNavigation("projects")}
        >
          back
        </div>
      )}

      <main style={{ overflowAnchor: "none" }} className="px-3 lg:px-5 pt-[88px] lg:pt-[120px] pb-20 lg:pb-40 flex flex-col gap-24 lg:gap-40">
        {PROJECT_ORDER.map((projectId) => (
          <article key={projectId} data-project-id={projectId} className="flex flex-col gap-3 lg:gap-5 scroll-mt-16">
            <ProjectHeader id={projectId} />
            {PROJECT_BODY[projectId]()}
          </article>
        ))}
      </main>
    </div>
  );
}

export default ProjectDetail;
export { ProjectDetail };
