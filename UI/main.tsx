import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from '@tauri-apps/api/window';
import App from "./App";
import ProcessSelectorApp from "./ProcessSelectorApp";
import ObjectAnalysisApp from "./ObjectAnalysisApp";
import "./App.css";

const init = async () => {
  const label = getCurrentWindow().label;
  const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

  const urlParams = new URLSearchParams(window.location.search);
  const windowParam = urlParams.get('window');

  if (label === 'process-selector' || windowParam === 'process-selector') {
    root.render(
      <React.StrictMode>
        <ProcessSelectorApp />
      </React.StrictMode>,
    );
  } else if (label === 'object-analysis' || windowParam === 'object-analysis') {
    root.render(
      <React.StrictMode>
        <ObjectAnalysisApp />
      </React.StrictMode>,
    );
  } else {
    // default to main App
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  }
};

init();
