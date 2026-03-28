interface Participant {
  name: string;
  identity?: string;
}

interface CommunicationReport {
  customerLeadName: string;      // 客户及线索名称
  communicationForm: string;    // 沟通形式
  timeRange: string;            // 时间段
  clientParticipants: string[]; // 客户方参与人及身份 (保留原始描述以防复杂身份)
  ourParticipants: string[];    // 我方参与人员
  sentToXiaoR: boolean;         // 是否发送小R
}

class ReportParser {
  /**
   * 解析原始文本块
   * @param text 整个输入的文本
   */
  public static parse(text: string): CommunicationReport[] {
    // 按照 【交流报备】 或 【交流报备-补充信息】 进行分割
    const blocks = text.split(/【交流报备(?:-补充信息)?】/).filter(block => block.trim().length > 0);

    return blocks.map(block => {
      const lines = block.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      
      const data: Partial<CommunicationReport> = {
        sentToXiaoR: false
      };

      lines.forEach(line => {
        // 1. 提取客户及线索名称
        if (line.startsWith('1、')) {
          data.customerLeadName = line.replace('1、客户及线索名称：', '').trim();
        } 
        
        // 2. 提取形式与时间
        else if (line.startsWith('2、')) {
          const content = line.replace('2、交流与沟通形式与发生时间：', '').trim();
          // 尝试分割形式和具体时间
          const parts = content.split(/[，,]/);
          data.communicationForm = parts[0];
          data.timeRange = parts.slice(1).join('，').trim();
        } 
        
        // 3. 提取客户人员
        else if (line.startsWith('3、')) {
          const content = line.replace('3、客户方人员数量及主要人员：', '').trim();
          // 移除开头的 "X人，"
          const namesOnly = content.replace(/^\d+\s*[人,，]\s*/, '');
          data.clientParticipants = namesOnly.split(/[，,]/).map(n => n.trim());
        } 
        
        // 4. 提取我方人员
        else if (line.startsWith('4、')) {
          const content = line.replace('4、我方人员姓名：', '').trim();
          // 移除开头的 "X人，"
          const namesOnly = content.replace(/^\d+\s*[人,，]\s*/, '');
          // 处理有些我方人员后面直接跟着（音频已发...）的情况
          const cleanNames = namesOnly.replace(/（[^）]*小\s*R[^）]*）/g, '');
          data.ourParticipants = cleanNames.split(/[，,]/).map(n => n.trim()).filter(n => n);
          
          // 特殊逻辑：检查小R是否在第4行括号内
          if (line.includes('小 R') || line.includes('小R')) {
            data.sentToXiaoR = true;
          }
        } 
        
        // 5. 提取录音状态
        else if (line.startsWith('5、')) {
          if (line.includes('小 R') || line.includes('小R')) {
            data.sentToXiaoR = true;
          }
        }
      });

      // 全局检索是否包含“录音已发送”字样，防止在非标行中出现
      if (block.includes('录音已发送') || block.includes('音频已发')) {
        data.sentToXiaoR = true;
      }

      return data as CommunicationReport;
    });
  }
}