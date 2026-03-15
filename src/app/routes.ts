import React from "react";
import { createBrowserRouter, Navigate } from "react-router";
import { Home } from "./components/Home";
import { ProjectDetail } from "./components/ProjectDetail";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Home,
  },
  {
    path: "/project/:id",
    Component: ProjectDetail,
  },
  // Static HTML app at public/compass/index.html — redirect so the server serves it
  {
    path: "/compass",
    element: React.createElement(Navigate, { to: "/compass/index.html", replace: true }),
  },
]);
