import React from "react";
import { useParams, useNavigate } from "react-router";
import { useState, useEffect } from "react";
import { Header } from "./Header";
import { ImageWithLoading, VideoWithLoading } from "./MediaWithLoading";
import { useLanguage } from "../contexts/LanguageContext";

interface ProjectData {
  youtubeEmbed?: string;
  images: string[];
}

const projectsMedia: Record<string, ProjectData> = {
  "1": {
    images: [
      "https://media.yujingshistudio.com/plant_KITCHEN.png",
      "https://media.yujingshistudio.com/plant_model2.png",
      "https://media.yujingshistudio.com/plant_model1.png",
      "https://media.yujingshistudio.com/plant_render.png",
    ],
  },
  "2": {
    youtubeEmbed: "https://www.youtube.com/embed/PZZ7LRT83KU?si=bf_5wOSnnhTMkoSh&start=1",
    images: [
      "https://media.yujingshistudio.com/tala_umbre.png",
      "https://media.yujingshistudio.com/tala_3types.png",
      "https://media.yujingshistudio.com/tala_station.png",
      "https://media.yujingshistudio.com/tala_train.png",
    ],
  },
  "3": {
    images: [
      "https://media.yujingshistudio.com/stockwell_workshop.jpg",
      "https://media.yujingshistudio.com/stockwell_model.jpg",
      "https://media.yujingshistudio.com/stockwell_render.png",
      "https://media.yujingshistudio.com/stockwell_detail.jpg",
      "https://media.yujingshistudio.com/stockwell_play.jpg",
    ],
  },
  "4": {
    images: [
      "https://media.yujingshistudio.com/time_box.mp4",
      "https://media.yujingshistudio.com/time_detail.JPG",
      "https://media.yujingshistudio.com/time_model.png",
      "https://media.yujingshistudio.com/time_rotate.mp4",
    ],
  },
};

function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useLanguage();
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
      const windowWidth = window.innerWidth;
      setShowBack(e.clientX < windowWidth / 5);
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

  useEffect(() => {
    if (!id) return;
    const timer = setTimeout(() => {
      const element = document.querySelector(`[data-project-id="${id}"]`);
      element?.scrollIntoView({ behavior: "smooth" });
    }, 100);
    return () => clearTimeout(timer);
  }, [id]);

  const allProjects = ["1", "2", "3", "4"].map((projectId) => ({
    id: projectId,
    title: t(`project.${projectId}.title`),
    description: t(`project.${projectId}.description`),
    ...projectsMedia[projectId],
  }));

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

      <div className="pt-14 px-3">
        {allProjects.map((project, projectIndex) => (
          <div
            key={project.id}
            data-project-id={project.id}
            className={projectIndex > 0 ? "mt-16 lg:mt-24" : ""}
          >
            <div className="mb-6">
              <h1 className="tracking-tight mb-4 lg:mb-6 font-bold text-[clamp(2rem,8vw,6rem)]">{project.title}</h1>
              <p className="text-base lg:text-xl leading-relaxed">{project.description}</p>
            </div>

            {project.youtubeEmbed && (
              <div className="mb-6">
                <div className="relative w-full" style={{ paddingBottom: "56.25%" }}>
                  <iframe
                    src={project.youtubeEmbed}
                    title="YouTube video player"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                    className="absolute top-0 left-0 w-full h-full"
                    style={{ border: 0 }}
                  />
                </div>
              </div>
            )}

            <div className="flex flex-col lg:flex-row gap-3">
              <div className="w-full lg:w-1/2 space-y-3 lg:space-y-6">
                {project.images.slice(0, 2).map((image, index) => (
                  <div key={index} className="relative">
                    {image.endsWith(".mp4") ? (
                      <VideoWithLoading
                        src={image}
                        fillHeight={false}
                        className="w-full h-auto object-cover"
                        loop
                        muted
                        autoPlay
                        playsInline
                      />
                    ) : (
                      <ImageWithLoading
                        src={image}
                        alt={`${project.title} - ${index + 1}`}
                        fillHeight={false}
                        className="w-full h-auto object-cover"
                      />
                    )}
                  </div>
                ))}
              </div>

              <div className="w-full lg:w-1/2 space-y-3 lg:space-y-6">
                {project.images.slice(2).map((image, index) => (
                  <div key={index} className="relative">
                    {image.endsWith(".mp4") ? (
                      <VideoWithLoading
                        src={image}
                        fillHeight={false}
                        className="w-full h-auto object-cover"
                        loop
                        muted
                        autoPlay
                        playsInline
                      />
                    ) : (
                      <ImageWithLoading
                        src={image}
                        alt={`${project.title} - ${index + 3}`}
                        fillHeight={false}
                        className="w-full h-auto object-cover"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default ProjectDetail;
export { ProjectDetail };
