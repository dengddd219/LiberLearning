<div className="w-[1280px] px-64 pt-32 pb-64 relative bg-stone-50 inline-flex flex-col justify-start items-start">
    <div className="w-full h-[2516.39px] max-w-[768px] relative">
        <div className="w-[768px] left-0 top-0 absolute inline-flex flex-col justify-start items-start gap-4">
            <div className="self-stretch inline-flex justify-start items-center gap-3">
                <div className="px-2 py-0.5 bg-neutral-200 rounded-2xl inline-flex flex-col justify-start items-start">
                    <div className="justify-center text-slate-600 text-xs font-medium font-['Inter'] uppercase leading-4 tracking-wide">ADVANCED PHILOSOPHY</div>
                </div>
                <div className="inline-flex flex-col justify-start items-start">
                    <div className="justify-center text-neutral-500 text-xs font-medium font-['Inter'] uppercase leading-4 tracking-wide">OCT 24, 2023</div>
                </div>
            </div>
            <div className="self-stretch flex flex-col justify-start items-start">
                <div className="self-stretch justify-center text-zinc-800 text-5xl font-extrabold font-['Inter'] leading-[60px]">7. 物品冷启动 (Cold Start Problem)</div>
            </div>
            <div className="self-stretch pt-4 inline-flex justify-start items-center gap-4">
                <div className="flex justify-start items-center gap-1.5">
                    <div className="inline-flex flex-col justify-start items-start">
                        <div className="w-2.5 h-2.5 bg-zinc-600" />
                    </div>
                    <div className="inline-flex flex-col justify-start items-start">
                        <div className="justify-center text-zinc-600 text-sm font-normal font-['Inter'] leading-5">Prof. Aris Thorne</div>
                    </div>
                </div>
                <div className="w-1 h-1 bg-zinc-400 rounded-full" />
                <div className="flex justify-start items-center gap-1.5">
                    <div className="inline-flex flex-col justify-start items-start">
                        <div className="w-3 h-3 bg-zinc-600" />
                    </div>
                    <div className="inline-flex flex-col justify-start items-start">
                        <div className="justify-center text-zinc-600 text-sm font-normal font-['Inter'] leading-5">45 min read</div>
                    </div>
                </div>
            </div>
        </div>
        <div className="w-[768px] left-0 top-[308.50px] absolute inline-flex flex-col justify-start items-start gap-16">
            <div className="self-stretch flex flex-col justify-start items-start gap-6">
                <div className="self-stretch flex flex-col justify-start items-start">
                    <div className="self-stretch justify-center text-zinc-600 text-xs font-bold font-['Inter'] uppercase leading-4 tracking-widest">SUMMARY</div>
                </div>
                <div className="self-stretch flex flex-col justify-start items-start">
                    <div className="self-stretch justify-center text-slate-600 text-lg font-normal font-['Inter'] leading-7">The &quot;Cold Start&quot; problem in recommendation systems refers to the challenge of providing<br/>relevant suggestions when there is insufficient data about a new item or user. This lecture<br/>explores strategies for overcoming this hurdle through content-based filtering and hybrid<br/>metadata modeling.</div>
                </div>
            </div>
            <div className="self-stretch flex flex-col justify-start items-start gap-8">
                <div className="self-stretch flex flex-col justify-start items-start">
                    <div className="self-stretch justify-center text-zinc-600 text-xs font-bold font-['Inter'] uppercase leading-4 tracking-widest">KEY CONCEPTS</div>
                </div>
                <div className="self-stretch flex flex-col justify-start items-start gap-2.5">
                    <div className="self-stretch flex flex-col justify-start items-start">
                        <div className="self-stretch justify-center text-zinc-800 text-xl font-bold font-['Inter'] leading-7">1. Definition of Item Cold Start</div>
                    </div>
                    <div className="self-stretch flex flex-col justify-start items-start">
                        <div className="self-stretch justify-center text-zinc-800 text-lg font-normal font-['Inter'] leading-8">An item cold start occurs when a new product is added to the catalog. Since no users<br/>have interacted with it yet, collaborative filtering algorithms cannot find &quot;similar users&quot; to<br/>recommend it to. This creates a &quot;chicken and egg&quot; paradox in data-driven discovery.</div>
                    </div>
                </div>
                <div className="self-stretch pl-8 py-2 border-l-4 border-neutral-200 flex flex-col justify-start items-start gap-3">
                    <div className="self-stretch inline-flex justify-start items-center gap-2">
                        <div className="inline-flex flex-col justify-start items-start">
                            <div className="w-3 h-3 bg-slate-600" />
                        </div>
                        <div className="justify-center text-slate-600 text-xs font-semibold font-['Inter'] uppercase leading-4 tracking-wide">AI PERSPECTIVE: CROSS-DOMAIN MAPPING</div>
                    </div>
                    <div className="self-stretch flex flex-col justify-start items-start">
                        <div className="self-stretch justify-center text-slate-600 text-base font-normal font-['Inter'] leading-7">Think of this as a library adding a book in a language no one has read yet. To suggest it, the<br/>librarian must look at the cover, the author, and the genre (metadata) rather than who checked it<br/>out previously.</div>
                    </div>
                </div>
                <div className="self-stretch flex flex-col justify-start items-start gap-2.5">
                    <div className="self-stretch flex flex-col justify-start items-start">
                        <div className="self-stretch justify-center text-zinc-800 text-xl font-bold font-['Inter'] leading-7">2. Content-Based Approaches</div>
                    </div>
                    <div className="self-stretch flex flex-col justify-start items-start">
                        <div className="self-stretch justify-center text-zinc-800 text-lg font-normal font-['Inter'] leading-8">The most common solution involves leveraging feature extraction. By analyzing the item&apos;s<br/>inherent properties—such as text descriptions, visual aesthetics, or categorical tags—we<br/>can map the new item into an existing embedding space.</div>
                    </div>
                </div>
            </div>
            <div className="self-stretch py-8 inline-flex flex-col justify-start items-start">
                <div className="self-stretch p-8 relative bg-white rounded-[32px] inline-flex flex-col justify-between items-start">
                    <div className="w-96 h-56 left-0 top-0 absolute bg-white/0 rounded-[32px] shadow-[0px_40px_40px_-15px_rgba(47,51,49,0.04)]" />
                    <div className="self-stretch flex flex-col justify-start items-start gap-1.5">
                        <div className="self-stretch flex flex-col justify-start items-start">
                            <div className="self-stretch justify-center text-zinc-800 text-base font-bold font-['Inter'] leading-6">Zero-Shot Learning</div>
                        </div>
                        <div className="self-stretch flex flex-col justify-start items-start">
                            <div className="self-stretch justify-center text-slate-600 text-sm font-normal font-['Inter'] leading-6">Leveraging pre-trained neural networks to<br/>understand item semantics without specific<br/>interaction data.</div>
                        </div>
                    </div>
                    <div className="self-stretch pt-6 flex flex-col justify-start items-start">
                        <div className="self-stretch pt-6 border-t border-stone-100 inline-flex justify-between items-center">
                            <div className="inline-flex flex-col justify-start items-start">
                                <div className="justify-center text-neutral-500 text-xs font-medium font-['Inter'] uppercase leading-4 tracking-wide">METHOD A</div>
                            </div>
                            <div className="inline-flex flex-col justify-start items-start">
                                <div className="w-4 h-4 bg-zinc-600" />
                            </div>
                        </div>
                    </div>
                </div>
                <div className="self-stretch p-8 bg-stone-100 rounded-[32px] inline-flex flex-col justify-between items-start">
                    <div className="self-stretch flex flex-col justify-start items-start gap-1.5">
                        <div className="self-stretch flex flex-col justify-start items-start">
                            <div className="self-stretch justify-center text-zinc-800 text-base font-bold font-['Inter'] leading-6">Active Exploration</div>
                        </div>
                        <div className="self-stretch flex flex-col justify-start items-start">
                            <div className="self-stretch justify-center text-slate-600 text-sm font-normal font-['Inter'] leading-6">Strategically showing new items to a diverse<br/>subset of users to gather initial training<br/>signals quickly.</div>
                        </div>
                    </div>
                    <div className="self-stretch pt-6 flex flex-col justify-start items-start">
                        <div className="self-stretch pt-6 border-t border-neutral-200 inline-flex justify-between items-center">
                            <div className="inline-flex flex-col justify-start items-start">
                                <div className="justify-center text-neutral-500 text-xs font-medium font-['Inter'] uppercase leading-4 tracking-wide">METHOD B</div>
                            </div>
                            <div className="inline-flex flex-col justify-start items-start">
                                <div className="w-5 h-3 bg-zinc-600" />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div className="self-stretch flex flex-col justify-start items-start gap-12">
                <div className="self-stretch flex flex-col justify-start items-start">
                    <div className="self-stretch justify-center text-zinc-600 text-xs font-bold font-['Inter'] uppercase leading-4 tracking-widest">DETAILED OBSERVATIONS</div>
                </div>
                <div className="self-stretch flex flex-col justify-start items-start gap-6">
                    <div className="self-stretch flex flex-col justify-start items-start">
                        <div className="self-stretch justify-center text-zinc-800 text-lg font-normal font-['Inter'] leading-8">During the Q&amp;A, the professor emphasized that the &quot;Warm-up&quot; phase is just as critical as<br/>the initial &quot;Cold&quot; state. As soon as the first 5-10 interactions are recorded, the model<br/>should pivot from pure content-based filtering to a hybrid approach to avoid the &quot;Filter<br/>Bubble&quot; effect.</div>
                    </div>
                    <div className="self-stretch pt-px flex flex-col justify-start items-start gap-4">
                        <div className="self-stretch bg-neutral-200 rounded-[32px] shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)] flex flex-col justify-center items-start overflow-hidden">
                            <img className="self-stretch h-96 relative opacity-80 mix-blend-overlay" src="https://placehold.co/768x432" />
                        </div>
                        <div className="self-stretch flex flex-col justify-start items-center">
                            <div className="text-center justify-center text-neutral-500 text-xs font-normal font-['Inter'] leading-4">Fig 7.1: The transition from sparse metadata to dense interaction manifolds.</div>
                        </div>
                    </div>
                    <div className="self-stretch flex flex-col justify-start items-start">
                        <div className="self-stretch justify-center text-zinc-800 text-lg font-normal font-['Inter'] leading-8">Final takeaway: The goal of cold start management is not just to find *any* user, but to<br/>find the *right* early adopters who can provide high-quality signal for the broader<br/>community.</div>
                    </div>
                </div>
            </div>
        </div>
        <div className="w-[768px] pt-16 left-0 top-[2403.39px] absolute border-t border-neutral-200 inline-flex justify-between items-center">
            <div className="flex justify-start items-center gap-4">
                <div className="w-12 h-12 bg-stone-100 rounded-full flex justify-center items-center">
                    <div className="inline-flex flex-col justify-start items-center">
                        <div className="w-4 h-4 bg-zinc-800" />
                    </div>
                </div>
                <div className="inline-flex flex-col justify-start items-start">
                    <div className="self-stretch flex flex-col justify-start items-start">
                        <div className="justify-center text-neutral-500 text-xs font-normal font-['Inter'] uppercase leading-4 tracking-wide">PREVIOUS</div>
                    </div>
                    <div className="self-stretch flex flex-col justify-start items-start">
                        <div className="justify-center text-zinc-800 text-base font-bold font-['Inter'] leading-6">6. Collaborative Filtering</div>
                    </div>
                </div>
            </div>
            <div className="flex justify-start items-center gap-4">
                <div className="inline-flex flex-col justify-start items-start">
                    <div className="self-stretch flex flex-col justify-start items-end">
                        <div className="text-right justify-center text-neutral-500 text-xs font-normal font-['Inter'] uppercase leading-4 tracking-wide">NEXT</div>
                    </div>
                    <div className="self-stretch flex flex-col justify-start items-end">
                        <div className="text-right justify-center text-zinc-800 text-base font-bold font-['Inter'] leading-6">8. Feedback Loops</div>
                    </div>
                </div>
                <div className="w-12 h-12 bg-stone-100 rounded-full flex justify-center items-center">
                    <div className="inline-flex flex-col justify-start items-end">
                        <div className="w-4 h-4 bg-zinc-800" />
                    </div>
                </div>
            </div>
        </div>
        <div className="w-[768px] pb-12 left-0 top-[212.50px] absolute inline-flex flex-col justify-start items-start">
            <div className="self-stretch inline-flex justify-center items-start">
                <div className="self-stretch p-1.5 bg-stone-100 rounded-full shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)] backdrop-blur-[6px] flex justify-start items-start gap-1">
                    <div className="px-6 py-2 bg-white rounded-full shadow-[0px_1px_2px_0px_rgba(0,0,0,0.05)] flex justify-start items-center gap-2">
                        <div className="inline-flex flex-col justify-start items-center">
                            <div className="w-3.5 h-3 bg-zinc-800" />
                        </div>
                        <div className="text-center justify-center text-zinc-800 text-sm font-medium font-['Inter'] leading-5">My Notes</div>
                    </div>
                    <div className="px-6 py-2 rounded-full flex justify-start items-center gap-2">
                        <div className="inline-flex flex-col justify-start items-center">
                            <div className="w-4 h-4 bg-slate-600" />
                        </div>
                        <div className="text-center justify-center text-slate-600 text-sm font-medium font-['Inter'] leading-5">AI Notes</div>
                    </div>
                </div>
            </div>
        </div>
    </div>
    <div className="w-[1280px] h-16 px-8 left-0 top-0 absolute bg-stone-50/80 backdrop-blur-md inline-flex justify-between items-center">
        <div className="w-[1280px] h-16 left-0 top-0 absolute bg-white/0 shadow-[0px_40px_40px_-15px_rgba(47,51,49,0.04)]" />
        <div className="flex justify-start items-center gap-6">
            <div className="inline-flex flex-col justify-start items-start">
                <div className="justify-center text-zinc-800 text-lg font-bold font-['Inter'] leading-7">StudyVellum</div>
            </div>
            <div className="flex justify-start items-center gap-6">
                <div className="inline-flex flex-col justify-start items-start">
                    <div className="justify-center text-slate-600 text-sm font-normal font-['Inter'] leading-5">Courses</div>
                </div>
                <div className="pb-1 border-b-2 border-zinc-600 inline-flex flex-col justify-start items-start">
                    <div className="justify-center text-zinc-800 text-sm font-normal font-['Inter'] leading-5">Library</div>
                </div>
                <div className="inline-flex flex-col justify-start items-start">
                    <div className="justify-center text-slate-600 text-sm font-normal font-['Inter'] leading-5">Archive</div>
                </div>
            </div>
        </div>
        <div className="flex justify-start items-center gap-4">
            <div className="px-3 py-1.5 bg-stone-100 rounded-full flex justify-start items-center gap-2">
                <div className="inline-flex flex-col justify-start items-start">
                    <div className="w-3.5 h-2 bg-zinc-800" />
                </div>
                <div className="inline-flex flex-col justify-start items-start">
                    <div className="justify-center text-zinc-800 text-sm font-medium font-['WenQuanYi_Zen_Hei'] leading-5">7. 物品冷启动</div>
                </div>
                <div className="inline-flex flex-col justify-start items-start">
                    <div className="w-2 h-1.5 bg-zinc-800" />
                </div>
            </div>
            <div className="flex justify-start items-center gap-2">
                <div className="p-2 rounded-full inline-flex flex-col justify-center items-center">
                    <div className="inline-flex justify-center items-start">
                        <div className="w-5 h-5 bg-zinc-800" />
                    </div>
                </div>
                <div className="p-2 rounded-full inline-flex flex-col justify-center items-center">
                    <div className="inline-flex justify-center items-start">
                        <div className="w-5 h-5 bg-zinc-800" />
                    </div>
                </div>
            </div>
        </div>
        <div className="w-[1280px] h-16 px-8 left-0 top-0 absolute bg-stone-50/80 backdrop-blur-md flex justify-between items-center">
            <div className="flex justify-start items-center gap-8">
                <div className="inline-flex flex-col justify-start items-start">
                    <div className="justify-center text-zinc-800 text-xl font-bold font-['Inter'] leading-7">LiberStudy</div>
                </div>
                <div className="outline outline-1 outline-offset-[-1px] flex justify-start items-center gap-6">
                    <div className="inline-flex flex-col justify-start items-start">
                        <div className="justify-center text-slate-600 text-base font-normal font-['Inter'] leading-6">Dashboard</div>
                    </div>
                    <div className="pb-1 border-b-2 border-zinc-600 inline-flex flex-col justify-start items-start">
                        <div className="justify-center text-slate-600 text-base font-normal font-['Inter'] leading-6">Courses</div>
                    </div>
                    <div className="inline-flex flex-col justify-start items-start">
                        <div className="justify-center text-black text-base font-normal font-['Inter'] leading-6">Detailed Note</div>
                    </div>
                </div>
            </div>
            <div className="flex justify-start items-center gap-4">
                <div className="inline-flex flex-col justify-center items-center">
                    <div className="w-4 h-5 bg-slate-600" />
                </div>
                <div className="inline-flex flex-col justify-center items-center">
                    <div className="w-5 h-5 bg-slate-600" />
                </div>
                <div className="w-8 h-8 bg-neutral-200 rounded-full inline-flex flex-col justify-start items-start overflow-hidden">
                    <img className="w-8 h-8 max-w-8 relative" src="https://placehold.co/32x32" />
                </div>
            </div>
        </div>
    </div>
</div>
000205; // 
2F3331; // 
556071; // 
5F5E5E; // 
777C79; // 
AFB3B0; // 
E6E9E6; // 
F3F4F1; // 
FAF9F7; // 
FAF9F7; // 
FFFFFF; // 
FFFFFF; // 
// ADVANCED PHILOSOPHY
text-slate-600
text-xs
font-medium
font-['Inter']
uppercase
leading-4
tracking-wide
---
// OCT 24, 2023
text-neutral-500
text-xs
font-medium
font-['Inter']
uppercase
leading-4
tracking-wide
---
// 7. 物品冷启动 (Cold Start Problem)
text-zinc-800
text-5xl
font-extrabold
font-['Inter']
leading-[60px]
---
// Prof. Aris Thorne
text-zinc-600
text-sm
font-normal
font-['Inter']
leading-5
---
// 45 min read
text-zinc-600
text-sm
font-normal
font-['Inter']
leading-5
---
// SUMMARY
text-zinc-600
text-xs
font-bold
font-['Inter']
uppercase
leading-4
tracking-widest
---
// The &quot;Cold Start&quot; problem in recommendation systems refers to the challenge of providing<br/>relevant suggestions when there is insufficient data about a new item or user. This lecture<br/>explores strategies for overcoming this hurdle through content-based filtering and hybrid<br/>metadata modeling.
text-slate-600
text-lg
font-normal
font-['Inter']
leading-7
---
// KEY CONCEPTS
text-zinc-600
text-xs
font-bold
font-['Inter']
uppercase
leading-4
tracking-widest
---
// 1. Definition of Item Cold Start
text-zinc-800
text-xl
font-bold
font-['Inter']
leading-7
---
// An item cold start occurs when a new product is added to the catalog. Since no users<br/>have interacted with it yet, collaborative filtering algorithms cannot find &quot;similar users&quot; to<br/>recommend it to. This creates a &quot;chicken and egg&quot; paradox in data-driven discovery.
text-zinc-800
text-lg
font-normal
font-['Inter']
leading-8
---
// AI PERSPECTIVE: CROSS-DOMAIN MAPPING
text-slate-600
text-xs
font-semibold
font-['Inter']
uppercase
leading-4
tracking-wide
---
// Think of this as a library adding a book in a language no one has read yet. To suggest it, the<br/>librarian must look at the cover, the author, and the genre (metadata) rather than who checked it<br/>out previously.
text-slate-600
text-base
font-normal
font-['Inter']
leading-7
---
// 2. Content-Based Approaches
text-zinc-800
text-xl
font-bold
font-['Inter']
leading-7
---
// The most common solution involves leveraging feature extraction. By analyzing the item&apos;s<br/>inherent properties—such as text descriptions, visual aesthetics, or categorical tags—we<br/>can map the new item into an existing embedding space.
text-zinc-800
text-lg
font-normal
font-['Inter']
leading-8
---
// Zero-Shot Learning
text-zinc-800
text-base
font-bold
font-['Inter']
leading-6
---
// Leveraging pre-trained neural networks to<br/>understand item semantics without specific<br/>interaction data.
text-slate-600
text-sm
font-normal
font-['Inter']
leading-6
---
// METHOD A
text-neutral-500
text-xs
font-medium
font-['Inter']
uppercase
leading-4
tracking-wide
---
// Active Exploration
text-zinc-800
text-base
font-bold
font-['Inter']
leading-6
---
// Strategically showing new items to a diverse<br/>subset of users to gather initial training<br/>signals quickly.
text-slate-600
text-sm
font-normal
font-['Inter']
leading-6
---
// METHOD B
text-neutral-500
text-xs
font-medium
font-['Inter']
uppercase
leading-4
tracking-wide
---
// DETAILED OBSERVATIONS
text-zinc-600
text-xs
font-bold
font-['Inter']
uppercase
leading-4
tracking-widest
---
// During the Q&amp;A, the professor emphasized that the &quot;Warm-up&quot; phase is just as critical as<br/>the initial &quot;Cold&quot; state. As soon as the first 5-10 interactions are recorded, the model<br/>should pivot from pure content-based filtering to a hybrid approach to avoid the &quot;Filter<br/>Bubble&quot; effect.
text-zinc-800
text-lg
font-normal
font-['Inter']
leading-8
---
// Fig 7.1: The transition from sparse metadata to dense interaction manifolds.
text-neutral-500
text-xs
font-normal
font-['Inter']
leading-4
---
// Final takeaway: The goal of cold start management is not just to find *any* user, but to<br/>find the *right* early adopters who can provide high-quality signal for the broader<br/>community.
text-zinc-800
text-lg
font-normal
font-['Inter']
leading-8
---
// PREVIOUS
text-neutral-500
text-xs
font-normal
font-['Inter']
uppercase
leading-4
tracking-wide
---
// 6. Collaborative Filtering
text-zinc-800
text-base
font-bold
font-['Inter']
leading-6
---
// NEXT
text-neutral-500
text-xs
font-normal
font-['Inter']
uppercase
leading-4
tracking-wide
---
// 8. Feedback Loops
text-zinc-800
text-base
font-bold
font-['Inter']
leading-6
---
// My Notes
text-zinc-800
text-sm
font-medium
font-['Inter']
leading-5
---
// AI Notes
text-slate-600
text-sm
font-medium
font-['Inter']
leading-5
---
// StudyVellum
text-zinc-800
text-lg
font-bold
font-['Inter']
leading-7
---
// Courses
text-slate-600
text-sm
font-normal
font-['Inter']
leading-5
---
// Library
text-zinc-800
text-sm
font-normal
font-['Inter']
leading-5
---
// Archive
text-slate-600
text-sm
font-normal
font-['Inter']
leading-5
---
// 7. 物品冷启动
text-zinc-800
text-sm
font-medium
font-['WenQuanYi_Zen_Hei']
leading-5
---
// LiberStudy
text-zinc-800
text-xl
font-bold
font-['Inter']
leading-7
---
// Dashboard
text-slate-600
text-base
font-normal
font-['Inter']
leading-6
---
// Courses
text-slate-600
text-base
font-normal
font-['Inter']
leading-6
---
// Detailed Note
text-black
text-base
font-normal
font-['Inter']
leading-6
