# React Bits Circular Carousel · 羊番适配

来源：https://reactbits.dev/components/circular-carousel
源码：https://reactbits.dev/r/CircularCarousel-TS-CSS.json
许可：https://github.com/DavidHDev/react-bits/blob/main/LICENSE.md
查阅和适配日期：2026-11-08。完整许可保存在同目录 LICENSE.md。

本目录是针对羊番首页的源码派生版本，不是未经修改的官方组件。保留官方的弹簧积分（SPRING 118、临界阻尼、小步积分）、指针运动采样与速度估计、惯性吸附、最近环绕角度、ResizeObserver / IntersectionObserver / visibilitychange 和按需 RAF 生命周期。

首页使用展开的前弧：四张海报、中央主海报、两侧透视；移除完整背环、图片分片弯曲、外部演示图片、连续漂移、入场秀和其它未使用预设。每张海报保留完整 2:1 图面和原有 MediaPreview，以固定媒体引用加载 original。自动逐张切换、暂停与焦点保护由 ProjectGallery 管理；拖动最多前进或后退一张，防止快速甩动跳过多部作品。选择只更新预览，明确进入才更新工作项目。

未新增依赖。官方原始文件和 registry 快照位于工作区 verification/2026-11-08-circular-carousel/reference。