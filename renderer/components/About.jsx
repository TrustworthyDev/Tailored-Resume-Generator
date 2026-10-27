import { useEffect, useState } from "react";
import { api } from "../lib/api";

// What the app is, in a few lines, and which version is running.
export default function About() {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    api().profileInfo().then((p) => setInfo(p || {}));
  }, []);

  return (
    <section className="card about-card">
      <div className="card-head">
        <h2>About RGenerator</h2>
        {info && info.version ? <span className="badge live">v{info.version}</span> : null}
      </div>
      <p className="about-lead">
        RGenerator builds a tailored resume for every job you apply to. Paste a job-post link,
        and it reads the posting, writes the resume with your own ChatGPT account, and saves a
        polished PDF — ready to file and track.
      </p>
      <ul className="about-points">
        <li>Extracts the role, company and full description straight from a job-post link.</li>
        <li>Runs up to 20 resumes at once, each in its own job tab.</li>
        <li>Over 20 resume templates, with your own colours and fonts.</li>
        <li>Keeps every application on record, with its resume, job post and ChatGPT chat.</li>
      </ul>
      <div className="about-meta">
        <div className="about-k">Version</div>
        <div className="about-v">{info && info.version ? info.version : "—"}</div>
        {info && info.profile ? (
          <>
            <div className="about-k">Profile</div>
            <div className="about-v">{info.profile}</div>
          </>
        ) : null}
        {info && info.sharedDatabase ? (
          <>
            <div className="about-k">Shared database</div>
            <div className="about-v">{info.sharedDatabase}</div>
          </>
        ) : null}
      </div>
    </section>
  );
}
