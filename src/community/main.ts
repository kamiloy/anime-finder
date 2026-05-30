// FanJi Community bundle entry —
// 按原 defer script 加载顺序导入：
//   api → auth → reviews → profile → feed
// 每个文件用 IIFE 自执行，副作用挂到 window.fanji 命名空间
import './api';
import './auth';
import './reviews';
import './profile';
import './feed';
