import React from "react";

import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Header } from "./Header";

const projects = [
  {
    id: 1,
    title: "Grow-Together",
    description: "A Modular Herb Pot Reducing Waste and Encouraging Community Sharing.",
    thumbnail: "https://media.yujingshistudio.com/plant_stick.mp4",
    video: "https://media.yujingshistudio.com/plant_stick.mp4",
  },
  {
    id: 2,
    title: "Co-design with Stockwell Community",
    description: "Co-designed Furniture with Stockwell Community.",
    thumbnail: "https://media.yujingshistudio.com/stockwell_render2.jpg",
  },
  {
    id: 3,
    title: "Orbital Time",
    description: "A timer that empowers users to redefine time in their own way.",
    thumbnail: "https://media.yujingshistudio.com/time_rotate.mp4",
  },
  // {
  //   id: 4,
  //   title: "A Traveller's Living-room",
  //   description: "Exploring the boundary between home and public space",
  //   thumbnail: "https://images.unsplash.com/photo-1560461396-ec0ef7bb29dd?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxtaW5pbWFsJTIwcHJvZHVjdCUyMGRlc2lnbnxlbnwxfHx8fDE3NzM0ODQxMDh8MA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral",
  // },
  // {
  //   id: 5,
  //   title: "Creative Space",
  //   description: "Workspace environment design",
  //   thumbnail: "https://images.unsplash.com/photo-1519217651866-847339e674d4?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxjcmVhdGl2ZSUyMHdvcmtzcGFjZXxlbnwxfHx8fDE3NzM0MTAwMjJ8MA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral",
  // },
  // {
  //   id: 6,
  //   title: "Art Installation",
  //   description: "Contemporary spatial art",
  //   thumbnail: "https://images.unsplash.com/photo-1723242017405-5018aa65ddad?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxjb250ZW1wb3JhcnklMjBhcnQlMjBpbnN0YWxsYXRpb258ZW58MXx8fHwxNzczMzkyMjgyfDA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral",
  // },
];

export function Home() {
  const navigate = useNavigate();
  const introRef = useRef<HTMLDivElement>(null);
  const projectsRef = useRef<HTMLDivElement>(null);
  const contactRef = useRef<HTMLDivElement>(null);
  const rightColumnRef = useRef<HTMLDivElement>(null);
  const [cursorPosition, setCursorPosition] = useState({ x: 0, y: 0 });
  const [showCursor, setShowCursor] = useState(false);
  const [showScrollCursor, setShowScrollCursor] = useState(false);

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

  const handleRightColumnMouseEnter = () => setShowScrollCursor(true);
  const handleRightColumnMouseLeave = () => setShowScrollCursor(false);
  const handleRightColumnMouseMove = (e: React.MouseEvent) => {
    setCursorPosition({ x: e.clientX, y: e.clientY });
  };

  return (
    <div className="min-h-screen bg-white overflow-hidden">
      <Header
        onHomeClick={scrollToTop}
        onProjectsClick={scrollToProjects}
        onContactClick={scrollToContact}
      />

      {/* Custom Cursor for project images - Hidden on mobile */}
      {showCursor && (
        <div
          className="fixed pointer-events-none z-50 text-white text-xl tracking-wider hidden lg:block"
          style={{
            left: `${cursorPosition.x}px`,
            top: `${cursorPosition.y}px`,
            transform: 'translate(-50%, -50%)',
          }}
        >
          enter
        </div>
      )}

      {/* Scroll Cursor for right column - Hidden on mobile */}
      {showScrollCursor && !showCursor && (
        <div
          className="fixed pointer-events-none z-50 text-gray-400 text-xl tracking-wider hidden lg:block"
          style={{
            left: `${cursorPosition.x}px`,
            top: `${cursorPosition.y}px`,
            transform: 'translate(-50%, -50%)',
          }}
        >
          scroll
        </div>
      )}

      {/* Main Layout - Single column on mobile, Two Columns on desktop */}
      <div className="flex flex-col lg:flex-row lg:h-screen">
        {/* Left Column - Fixed on desktop, compact on mobile */}
        <div className="w-full lg:w-1/2 flex items-start px-3 pt-20 pb-8 lg:pb-0 lg:fixed lg:h-screen">
          <h1 className="font-bold leading-none tracking-tight text-[clamp(2.5rem,10vw,12.5rem)]">
            Hi, I'm<br />Yujing Shi,
          </h1>
        </div>

        {/* Right Column - Scrollable */}
        <div
          ref={rightColumnRef}
          className="w-full lg:w-1/2 lg:ml-[50%] lg:overflow-y-auto"
          style={{ scrollBehavior: "smooth" }}
          onMouseMove={handleRightColumnMouseMove}
          onMouseEnter={handleRightColumnMouseEnter}
          onMouseLeave={handleRightColumnMouseLeave}
        >
          {/* Intro Section */}
          <div ref={introRef} className="lg:min-h-screen flex items-start lg:items-end px-3 pb-8">
            <p className="text-lg lg:text-2xl leading-relaxed font-light">
              I'm a product and experience designer exploring embodied and inclusive interaction. 
              Based in London, working at the intersection 
              of object-making, computing, and spatial curation.
              Currently studying Product & Furniture Design at UAL, 
              with a Creative Computing diploma from CCI.
            </p>
          </div>

          {/* Projects Section */}
          <div ref={projectsRef} data-section="projects" className="min-h-screen py-8 px-3">
            <h2 className="tracking-tight mb-8 text-[28px] lg:text-[36px] italic font-bold">PROJECTS</h2>
            <div className="space-y-6">
              {projects.map((project, index) => (
                <button
                  key={project.id}
                  onClick={() => navigate(`/project/${project.id}`)}
                  onMouseMove={handleMouseMove}
                  onMouseEnter={handleMouseEnter}
                  onMouseLeave={handleMouseLeave}
                  className="block w-full group lg:cursor-none"
                >
                  <div className="aspect-[4/3] overflow-hidden relative">
                    {project.thumbnail.endsWith('.mp4') ? (
                      // 视频缩略图
                      <video
                        src={project.thumbnail}
                        loop
                        muted
                        playsInline
                        onMouseEnter={(e) => e.currentTarget.play()}
                        onMouseLeave={(e) => e.currentTarget.pause()}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    ) : (
                      // 图片缩略图
                      <img
                        src={project.thumbnail}
                        alt={project.title}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                    )}
                  </div>
                  <p className="mt-2 text-sm tracking-wider text-left">
                    {project.description}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {/* Contact Section */}
          <div ref={contactRef} data-section="contact" className="min-h-screen py-8 px-3">
            <div className="flex flex-col lg:flex-row gap-8">
              {/* Contact Info */}
              <div className="flex-1">
                <h2 className="text-[28px] lg:text-[36px] tracking-tight mb-8 font-bold">CONTACT</h2>
                <div className="space-y-4">
                  <div>
                    <p className="text-lg lg:text-xl text-gray-500 mb-2">Instagram</p>
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
                    <p className="text-lg lg:text-xl text-gray-500 mb-2">Behance</p>
                    <a
                      href="https://behance.net/yujingshi6"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-lg lg:text-xl hover:opacity-60 transition-opacity"
                    >
                      behance.net/yujingshi6
                    </a>
                  </div>
                  <div>
                    <p className="text-lg lg:text-xl text-gray-500 mb-2">LinkedIn</p>
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
                    <p className="text-lg lg:text-xl text-gray-500 mb-2">Email</p>
                    <a
                      href="mailto:shi.yujing@outlook.com"
                      className="block text-lg lg:text-xl hover:opacity-60 transition-opacity"
                    >
                      shi.yujing@outlook.com
                    </a>
                  </div>
                </div>
              </div>

              {/* Photo */}
              <div className="flex-1">
                <div className="aspect-[3/4] overflow-hidden">
                  <img
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