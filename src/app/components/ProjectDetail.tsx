import React from "react";
import { useParams, useNavigate } from "react-router";
import { useState, useEffect } from "react";
import { Header } from "./Header";

interface Project {
  title: string;
  description: string;
  images: string[];
}

const projectsData: Record<string, Project> = {
  "1": {
    title: "Grow-Together",
    description: "Excess food waste is a big challenge for everyone who lives alone. At the same time, for students living in an international student accommodation, trying to connect with flatmates from diverse cultures is essential and challenging. This project explores growing herbs can foster a more sustainable and socially connected community. The final design is a modular self-sustaining herb pot, encouraging students to reduce waste and strengthen the bonds through growing, maintaining, and sharing herbs. ",
    images: [
      
      "https://media.yujingshistudio.com/plant_KITCHEN.png",
      "https://media.yujingshistudio.com/plant_model2.png",
      "https://media.yujingshistudio.com/plant_model1.png",
      "https://media.yujingshistudio.com/plant_KITCHEN.png"
      
      ],
  },
  "2": {
    title: "Co-designed Furniture with Stockwell Community",
    description: "Commissioned by Stockwell Trust, this project designs furniture for Stockwell's new art centre through a series of co-design workshops with local residents. A drying and displaying shelf is made to empower the creatives of different abilities. Responding to both physical and emotional needs, this shelf allows every artwork to be seen in its necessary drying process, making every printing and painting session a temporary exhibition. ",
    images: [
      "https://media.yujingshistudio.com/stockwell_workshop.jpg",
      "https://media.yujingshistudio.com/stockwell_model.jpg",
      "https://media.yujingshistudio.com/stockwell_render.png",
      "https://media.yujingshistudio.com/stockwell_detail.jpg",
      "https://media.yujingshistudio.com/stockwell_play.jpg"
      ],
  },
  "3": {
    title: "Orbital Time",
    description:
      "A visual exploration of geometric forms and patterns, investigating the relationship between structure and randomness. This project examines how repetition and variation can create compelling visual rhythms, drawing inspiration from both natural and man-made patterns. The work challenges conventional perceptions of space and form through abstract compositions.",
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
  const [showBack, setShowBack] = useState(false);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [headerVisible, setHeaderVisible] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);

  const handleNavigation = (section?: string) => {
    if (section) {
      navigate(`/?section=${section}`);
    } else {
      navigate("/");
    }
  };

  // 监听鼠标移动，显示back文字
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({ x: e.clientX, y: e.clientY });
      // 检查鼠标是否在左边1/5的区域
      const windowWidth = window.innerWidth;
      setShowBack(e.clientX < windowWidth / 5);
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  // 监听滚动，控制header显示/隐藏
  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;

      setLastScrollY((prevScrollY) => {
        if (currentScrollY > prevScrollY && currentScrollY > 50) {
          // 向下滚动且超过50px，隐藏header
          setHeaderVisible(false);
        } else if (currentScrollY < prevScrollY) {
          // 向上滚动，显示header
          setHeaderVisible(true);
        }

        return currentScrollY;
      });
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // 滚动到当前项目
  useEffect(() => {
    if (!id) return;
    const timer = setTimeout(() => {
      const element = document.querySelector(`[data-project-id="${id}"]`);
      element?.scrollIntoView({ behavior: "smooth" });
    }, 100);
    return () => clearTimeout(timer);
  }, [id]);

  // 获取所有项目数组
  const allProjects = Object.entries(projectsData).map(([id, project]) => ({
    id,
    ...project,
  }));

  return (
    <div className="min-h-screen bg-white">
      <Header
        onHomeClick={() => handleNavigation()}
        onProjectsClick={() => handleNavigation("projects")}
        onContactClick={() => handleNavigation("contact")}
        isVisible={headerVisible}
      />

      {/* 返回文字 - Hidden on mobile */}
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
        {/* 渲染所有项目 */}
        {allProjects.map((project, projectIndex) => (
          <div 
            key={project.id} 
            data-project-id={project.id}
            className={projectIndex > 0 ? "mt-16 lg:mt-24" : ""}
          >
            {/* Title and Description - Full Width */}
            <div className="mb-6">
              <h1 className="tracking-tight mb-4 lg:mb-6 font-bold text-[clamp(2rem,8vw,6rem)]">
                {project.title}
              </h1>
              <p className="text-base lg:text-xl leading-relaxed">{project.description}</p>
            </div>

            {/* Images - Single column on mobile, Two columns on desktop */}
            <div className="flex flex-col lg:flex-row gap-3">
              {/* Left Column - First two images */}
              <div className="w-full lg:w-1/2 space-y-3 lg:space-y-6">
                {project.images.slice(0, 2).map((image, index) => (
                  <div key={index}>
                    {image.endsWith('.mp4') ? (
                      <video
                        src={image}
                        className="w-full h-auto object-cover"
                        loop
                        muted
                        autoPlay
                        playsInline
                      />
                    ) : (
                      <img
                        src={image}
                        alt={`${project.title} - ${index + 1}`}
                        className="w-full h-auto object-cover"
                      />
                    )}
                  </div>
                ))}
              </div>

              {/* Right Column - Last images */}
              <div className="w-full lg:w-1/2 space-y-3 lg:space-y-6">
                {project.images.slice(2).map((image, index) => (
                  <div key={index}>
                    {image.endsWith('.mp4') ? (
                      <video
                        src={image}
                        className="w-full h-auto object-cover"
                        loop
                        muted
                        autoPlay
                        playsInline
                      />
                    ) : (
                      <img
                        src={image}
                        alt={`${project.title} - ${index + 3}`}
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