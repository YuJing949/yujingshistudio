import { createBrowserRouter } from "react-router";
import { Home } from "./components/Home";
import { ProjectDetail } from "./components/ProjectDetail";
import { CompassPage } from "./components/CompassPage";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Home,
  },
  {
    path: "/project/:id",
    Component: ProjectDetail,
  },
  {
    path: "/compass",
    Component: CompassPage,
  },
  {
    path: "/compass/",
    Component: CompassPage,
  },
]);
